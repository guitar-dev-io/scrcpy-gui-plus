//! Browser-playable video for screen sharing.
//!
//! scrcpy delivers H.264 access units in Annex B form. Browsers on a plain
//! `http://` LAN address cannot use WebCodecs (it needs a secure context), but
//! they can play fragmented MP4 through Media Source Extensions. This module
//! repackages the access units as fMP4 without decoding or re-encoding them,
//! so the cost per frame is a copy and a few small headers.
//!
//! Input is the app's internal video hub message format:
//! `[kind=1][flags][pts:u64][len:u32][payload]` for packets (flags bit0 =
//! codec config, bit1 = key frame) and `[kind=2][width:u32][height:u32]` for
//! the frame size.
//!
//! Timestamps are synthetic and contiguous (one fixed frame duration per
//! sample) instead of scrcpy's real pts. scrcpy only emits a frame when the
//! screen changes, so real timestamps would leave gaps in the buffer that the
//! player stalls on. Contiguous timestamps plus a live-edge seek in the page
//! keep the newest frame on screen.

/// Media timescale and the fixed duration of one frame (60 fps).
const TIMESCALE: u32 = 90_000;
const FRAME_TICKS: u32 = 1_500;
const FALLBACK_SIZE: (u32, u32) = (720, 1280);

const NAL_IDR: u8 = 5;
const NAL_SPS: u8 = 7;
const NAL_PPS: u8 = 8;
const NAL_AUD: u8 = 9;

/// What a pushed message produced for the HTTP stream.
#[derive(Debug, PartialEq, Eq)]
pub enum MuxEvent {
    /// Initialization segment plus the `codecs=` string needed to open the
    /// player's source buffer.
    Init { codec: String, bytes: Vec<u8> },
    /// One `moof` + `mdat` pair holding a single frame.
    Fragment(Vec<u8>),
    /// The codec configuration changed (for example after a rotation). The
    /// stream cannot continue in the same source buffer; the caller ends it so
    /// the page reconnects with a fresh init segment.
    Reconfigured,
}

#[derive(Default)]
pub struct Fmp4Muxer {
    width: u32,
    height: u32,
    config: Option<(Vec<u8>, Vec<u8>)>,
    sequence: u32,
    decode_time: u64,
    seen_key: bool,
}

impl Fmp4Muxer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, message: &[u8]) -> Vec<MuxEvent> {
        match message.first() {
            Some(2) if message.len() >= 9 => {
                self.width = u32::from_be_bytes(message[1..5].try_into().unwrap());
                self.height = u32::from_be_bytes(message[5..9].try_into().unwrap());
                Vec::new()
            }
            Some(1) if message.len() > 14 => {
                let flags = message[1];
                self.packet(flags & 0x01 != 0, flags & 0x02 != 0, &message[14..])
            }
            _ => Vec::new(),
        }
    }

    fn packet(&mut self, is_config: bool, flagged_key: bool, payload: &[u8]) -> Vec<MuxEvent> {
        let nals = split_annex_b(payload);
        if is_config {
            let sps = nals.iter().find(|nal| nal_type(nal) == NAL_SPS);
            let pps = nals.iter().find(|nal| nal_type(nal) == NAL_PPS);
            let (Some(sps), Some(pps)) = (sps, pps) else {
                return Vec::new();
            };
            return match &self.config {
                Some((old_sps, old_pps)) if old_sps == sps && old_pps == pps => Vec::new(),
                Some(_) => vec![MuxEvent::Reconfigured],
                None => {
                    self.config = Some((sps.to_vec(), pps.to_vec()));
                    let (width, height) = if self.width > 0 && self.height > 0 {
                        (self.width, self.height)
                    } else {
                        FALLBACK_SIZE
                    };
                    vec![MuxEvent::Init {
                        codec: codec_string(sps),
                        bytes: init_segment(sps, pps, width, height),
                    }]
                }
            };
        }

        if self.config.is_none() {
            return Vec::new();
        }
        let is_key = flagged_key || nals.iter().any(|nal| nal_type(nal) == NAL_IDR);
        // The first frame a player sees must be a key frame.
        if !self.seen_key && !is_key {
            return Vec::new();
        }
        self.seen_key = true;

        let sample = to_length_prefixed(&nals);
        if sample.is_empty() {
            return Vec::new();
        }
        self.sequence = self.sequence.wrapping_add(1);
        let fragment = fragment(self.sequence, self.decode_time, is_key, &sample);
        self.decode_time += u64::from(FRAME_TICKS);
        vec![MuxEvent::Fragment(fragment)]
    }
}

fn nal_type(nal: &[u8]) -> u8 {
    nal.first().map_or(0, |byte| byte & 0x1f)
}

/// Splits an Annex B byte stream into NAL units (start codes removed).
pub fn split_annex_b(data: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= data.len() {
        if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
            starts.push(i + 3);
            i += 3;
        } else {
            i += 1;
        }
    }
    let mut nals = Vec::with_capacity(starts.len());
    for (index, &start) in starts.iter().enumerate() {
        let mut end = starts.get(index + 1).map_or(data.len(), |next| next - 3);
        // A 4-byte start code leaves one extra zero on the previous NAL.
        while end > start && data[end - 1] == 0 {
            end -= 1;
        }
        if end > start {
            nals.push(&data[start..end]);
        }
    }
    nals
}

/// AVCC sample: each NAL behind a 4-byte length, with parameter sets and
/// access unit delimiters left out (they live in the init segment).
fn to_length_prefixed(nals: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for nal in nals {
        if matches!(nal_type(nal), NAL_SPS | NAL_PPS | NAL_AUD) {
            continue;
        }
        out.extend_from_slice(&(nal.len() as u32).to_be_bytes());
        out.extend_from_slice(nal);
    }
    out
}

/// `avc1.PPCCLL` from the SPS profile, constraint and level bytes.
fn codec_string(sps: &[u8]) -> String {
    format!(
        "avc1.{:02x}{:02x}{:02x}",
        sps.get(1).copied().unwrap_or(0x42),
        sps.get(2).copied().unwrap_or(0),
        sps.get(3).copied().unwrap_or(0x1e)
    )
}

fn bx(kind: &[u8; 4], body: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&((8 + body.len()) as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(body);
    out
}

fn full_box(kind: &[u8; 4], version: u8, flags: u32, body: &[u8]) -> Vec<u8> {
    let mut inner = Vec::with_capacity(4 + body.len());
    inner.push(version);
    inner.extend_from_slice(&flags.to_be_bytes()[1..]);
    inner.extend_from_slice(body);
    bx(kind, &inner)
}

fn cat(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

const IDENTITY_MATRIX: [u32; 9] = [0x0001_0000, 0, 0, 0, 0x0001_0000, 0, 0, 0, 0x4000_0000];

fn words(values: &[u32]) -> Vec<u8> {
    values.iter().flat_map(|value| value.to_be_bytes()).collect()
}

fn avcc(sps: &[u8], pps: &[u8]) -> Vec<u8> {
    let profile = sps.get(1).copied().unwrap_or(0x42);
    let mut body = vec![
        1,
        profile,
        sps.get(2).copied().unwrap_or(0),
        sps.get(3).copied().unwrap_or(0x1e),
        0xff, // 4-byte NAL lengths
        0xe1, // one SPS
    ];
    body.extend_from_slice(&(sps.len() as u16).to_be_bytes());
    body.extend_from_slice(sps);
    body.push(1); // one PPS
    body.extend_from_slice(&(pps.len() as u16).to_be_bytes());
    body.extend_from_slice(pps);
    // High profiles carry chroma and bit depth after the parameter sets.
    if matches!(profile, 100 | 110 | 122 | 244 | 44 | 83 | 86 | 118 | 128 | 138 | 139 | 134) {
        body.extend_from_slice(&[0xfd, 0xf8, 0xf8, 0]);
    }
    bx(b"avcC", &body)
}

fn init_segment(sps: &[u8], pps: &[u8], width: u32, height: u32) -> Vec<u8> {
    let (w16, h16) = (width.min(u32::from(u16::MAX)) as u16, height.min(u32::from(u16::MAX)) as u16);

    let ftyp = bx(b"ftyp", &cat(&[b"isom", &0u32.to_be_bytes(), b"isom", b"iso2", b"avc1", b"mp41"]));

    let mvhd = full_box(
        b"mvhd",
        0,
        0,
        &cat(&[
            &words(&[0, 0, 1000, 0, 0x0001_0000]),
            &0x0100u16.to_be_bytes(),
            &[0u8; 10],
            &words(&IDENTITY_MATRIX),
            &[0u8; 24],
            &2u32.to_be_bytes(),
        ]),
    );
    let tkhd = full_box(
        b"tkhd",
        0,
        3,
        &cat(&[
            &words(&[0, 0, 1, 0, 0]),
            &[0u8; 8],
            &[0u8; 8],
            &words(&IDENTITY_MATRIX),
            &(width << 16).to_be_bytes(),
            &(height << 16).to_be_bytes(),
        ]),
    );
    let mdhd = full_box(
        b"mdhd",
        0,
        0,
        &cat(&[&words(&[0, 0, TIMESCALE, 0]), &0x55c4u16.to_be_bytes(), &0u16.to_be_bytes()]),
    );
    let hdlr = full_box(
        b"hdlr",
        0,
        0,
        &cat(&[&0u32.to_be_bytes(), b"vide", &[0u8; 12], b"VideoHandler\0"]),
    );
    let vmhd = full_box(b"vmhd", 0, 1, &[0u8; 8]);
    let dinf = bx(
        b"dinf",
        &full_box(b"dref", 0, 0, &cat(&[&1u32.to_be_bytes(), &full_box(b"url ", 0, 1, &[])])),
    );
    let avc1 = bx(
        b"avc1",
        &cat(&[
            &[0u8; 6],
            &1u16.to_be_bytes(),
            &[0u8; 16],
            &w16.to_be_bytes(),
            &h16.to_be_bytes(),
            &0x0048_0000u32.to_be_bytes(),
            &0x0048_0000u32.to_be_bytes(),
            &0u32.to_be_bytes(),
            &1u16.to_be_bytes(),
            &[0u8; 32],
            &0x0018u16.to_be_bytes(),
            &0xffffu16.to_be_bytes(),
            &avcc(sps, pps),
        ]),
    );
    let stsd = full_box(b"stsd", 0, 0, &cat(&[&1u32.to_be_bytes(), &avc1]));
    let stbl = bx(
        b"stbl",
        &cat(&[
            &stsd,
            &full_box(b"stts", 0, 0, &0u32.to_be_bytes()),
            &full_box(b"stsc", 0, 0, &0u32.to_be_bytes()),
            &full_box(b"stsz", 0, 0, &[0u8; 8]),
            &full_box(b"stco", 0, 0, &0u32.to_be_bytes()),
        ]),
    );
    let minf = bx(b"minf", &cat(&[&vmhd, &dinf, &stbl]));
    let mdia = bx(b"mdia", &cat(&[&mdhd, &hdlr, &minf]));
    let trak = bx(b"trak", &cat(&[&tkhd, &mdia]));
    let trex = full_box(b"trex", 0, 0, &words(&[1, 1, 0, 0, 0]));
    let mvex = bx(b"mvex", &trex);
    let moov = bx(b"moov", &cat(&[&mvhd, &trak, &mvex]));
    cat(&[&ftyp, &moov])
}

/// One frame as `moof` + `mdat`.
fn fragment(sequence: u32, decode_time: u64, is_key: bool, sample: &[u8]) -> Vec<u8> {
    // sample_depends_on=2 for sync samples; depends_on=1 plus non-sync otherwise.
    let sample_flags: u32 = if is_key { 0x0200_0000 } else { 0x0101_0000 };
    let moof = |data_offset: i32| {
        let mfhd = full_box(b"mfhd", 0, 0, &sequence.to_be_bytes());
        let tfhd = full_box(b"tfhd", 0, 0x02_0000, &1u32.to_be_bytes());
        let tfdt = full_box(b"tfdt", 1, 0, &decode_time.to_be_bytes());
        let trun = full_box(
            b"trun",
            0,
            0x0701,
            &cat(&[
                &1u32.to_be_bytes(),
                &data_offset.to_be_bytes(),
                &FRAME_TICKS.to_be_bytes(),
                &(sample.len() as u32).to_be_bytes(),
                &sample_flags.to_be_bytes(),
            ]),
        );
        bx(b"moof", &cat(&[&mfhd, &bx(b"traf", &cat(&[&tfhd, &tfdt, &trun]))]))
    };
    // The offset points past the moof and the mdat header; its own size does
    // not depend on the value, so one measuring pass is enough.
    let head = moof(0);
    let head = moof(head.len() as i32 + 8);
    cat(&[&head, &bx(b"mdat", sample)])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn boxes(data: &[u8]) -> Vec<(String, &[u8])> {
        let mut out = Vec::new();
        let mut at = 0;
        while at < data.len() {
            let size = u32::from_be_bytes(data[at..at + 4].try_into().unwrap()) as usize;
            assert!(size >= 8 && at + size <= data.len(), "box size {size} at {at} overruns");
            out.push((String::from_utf8_lossy(&data[at + 4..at + 8]).to_string(), &data[at + 8..at + size]));
            at += size;
        }
        out
    }

    fn child<'a>(parent: &'a [u8], kind: &str) -> &'a [u8] {
        boxes(parent).into_iter().find(|(k, _)| k == kind).unwrap_or_else(|| panic!("no {kind}")).1
    }

    const SPS: &[u8] = &[0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9, 0x40];
    const PPS: &[u8] = &[0x68, 0xeb, 0xe3, 0xcb, 0x22, 0xc0];

    fn packet(kind_flags: u8, payload: &[u8]) -> Vec<u8> {
        let mut m = vec![1, kind_flags];
        m.extend_from_slice(&0u64.to_be_bytes());
        m.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        m.extend_from_slice(payload);
        m
    }

    fn annex_b(nals: &[&[u8]]) -> Vec<u8> {
        nals.iter().flat_map(|nal| [&[0u8, 0, 0, 1][..], nal].concat()).collect()
    }

    fn dims(w: u32, h: u32) -> Vec<u8> {
        let mut m = vec![2];
        m.extend_from_slice(&w.to_be_bytes());
        m.extend_from_slice(&h.to_be_bytes());
        m
    }

    #[test]
    fn splits_three_and_four_byte_start_codes() {
        let data = [0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 9];
        let nals = split_annex_b(&data);
        assert_eq!(nals, vec![&[0x67, 1, 2][..], &[0x68, 3][..], &[0x65, 9][..]]);
    }

    #[test]
    fn length_prefix_drops_parameter_sets_and_delimiters() {
        let nals = [&[0x09, 0xf0][..], SPS, PPS, &[0x65, 0xaa, 0xbb][..]];
        assert_eq!(to_length_prefixed(&nals), [0, 0, 0, 3, 0x65, 0xaa, 0xbb]);
    }

    #[test]
    fn codec_string_comes_from_sps() {
        assert_eq!(codec_string(SPS), "avc1.64001f");
    }

    #[test]
    fn init_segment_is_well_formed() {
        let init = init_segment(SPS, PPS, 1200, 2640);
        let top = boxes(&init);
        assert_eq!(top.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["ftyp", "moov"]);
        let moov = top[1].1;
        let kinds: Vec<_> = boxes(moov).iter().map(|(k, _)| k.clone()).collect();
        assert_eq!(kinds, ["mvhd", "trak", "mvex"]);
        let stbl = child(child(child(child(moov, "trak"), "mdia"), "minf"), "stbl");
        let stsd = child(stbl, "stsd");
        let avc1 = child(&stsd[8..], "avc1");
        // 78-byte visual sample entry header, then the avcC box
        let avcc = child(&avc1[78..], "avcC");
        assert_eq!(&avcc[..4], [1, 0x64, 0x00, 0x1f]);
        assert!(avcc.windows(SPS.len()).any(|w| w == SPS) && avcc.windows(PPS.len()).any(|w| w == PPS));
        assert_eq!(&avcc[avcc.len() - 4..], [0xfd, 0xf8, 0xf8, 0], "high profile extension");
    }

    #[test]
    fn fragment_offset_points_at_the_sample() {
        let sample = [0, 0, 0, 3, 0x65, 1, 2];
        let data = fragment(7, 3000, true, &sample);
        let top = boxes(&data);
        assert_eq!(top.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["moof", "mdat"]);
        assert_eq!(top[1].1, sample);
        let traf = child(top[0].1, "traf");
        let trun = child(traf, "trun");
        let offset = i32::from_be_bytes(trun[8..12].try_into().unwrap()) as usize;
        assert_eq!(&data[offset..offset + sample.len()], sample, "data_offset is relative to the moof start");
        let tfdt = child(traf, "tfdt");
        assert_eq!(u64::from_be_bytes(tfdt[4..12].try_into().unwrap()), 3000);
        let flags = u32::from_be_bytes(trun[20..24].try_into().unwrap());
        assert_eq!(flags, 0x0200_0000);
    }

    #[test]
    fn muxer_waits_for_config_and_a_key_frame() {
        let mut mux = Fmp4Muxer::new();
        let delta = packet(0, &annex_b(&[&[0x41, 1, 2, 3]]));
        let key = packet(2, &annex_b(&[&[0x65, 9, 9]]));
        assert!(mux.push(&delta).is_empty(), "no init yet");
        mux.push(&dims(1200, 2640));
        let events = mux.push(&packet(1, &annex_b(&[SPS, PPS])));
        assert!(matches!(&events[..], [MuxEvent::Init { codec, .. }] if codec == "avc1.64001f"));
        assert!(mux.push(&delta).is_empty(), "first frame must be a key frame");
        assert!(matches!(&mux.push(&key)[..], [MuxEvent::Fragment(_)]));
        assert!(matches!(&mux.push(&delta)[..], [MuxEvent::Fragment(_)]));
    }

    #[test]
    fn muxer_timestamps_are_contiguous_and_sequenced() {
        let mut mux = Fmp4Muxer::new();
        mux.push(&packet(1, &annex_b(&[SPS, PPS])));
        let key = packet(2, &annex_b(&[&[0x65, 1]]));
        let mut times = Vec::new();
        for _ in 0..3 {
            let MuxEvent::Fragment(data) = mux.push(&key).remove(0) else { panic!() };
            let moof = boxes(&data)[0].1;
            let traf = child(moof, "traf");
            times.push(u64::from_be_bytes(child(traf, "tfdt")[4..12].try_into().unwrap()));
        }
        assert_eq!(times, [0, 1500, 3000]);
    }

    #[test]
    fn identical_config_is_ignored_and_changed_config_reconfigures() {
        let mut mux = Fmp4Muxer::new();
        let config = packet(1, &annex_b(&[SPS, PPS]));
        assert_eq!(mux.push(&config).len(), 1);
        assert!(mux.push(&config).is_empty());
        let other_sps = [0x67, 0x64, 0x00, 0x2a, 0xac];
        assert_eq!(mux.push(&packet(1, &annex_b(&[&other_sps, PPS]))), vec![MuxEvent::Reconfigured]);
    }

    #[test]
    fn idr_nal_counts_as_key_even_without_the_flag() {
        let mut mux = Fmp4Muxer::new();
        mux.push(&packet(1, &annex_b(&[SPS, PPS])));
        assert!(matches!(&mux.push(&packet(0, &annex_b(&[&[0x65, 1]])))[..], [MuxEvent::Fragment(_)]));
    }
}
