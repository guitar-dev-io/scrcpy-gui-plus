import { describe, expect, it } from 'vitest'
import type { QrContentType, QrFieldValues } from '../types/qrStudio'
import {
  detectType,
  encode,
  estimateQrCapacity,
  launchableUri,
  parseFields,
  smsToViewUri,
  validateUri,
} from './qrEncoders'

const content = (fields: QrFieldValues) => {
  const result = encode(fields)
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.content
}
const errors = (fields: QrFieldValues) => {
  const result = encode(fields)
  if (result.ok) throw new Error(`expected failure, got ${result.content}`)
  return result.errors
}
const wifi = (over: Partial<Extract<QrFieldValues, { type: 'wifi' }>> = {}): QrFieldValues => ({
  type: 'wifi', ssid: 'Home', password: 'password1', security: 'WPA', hidden: false, ...over,
})

describe('wifi', () => {
  it('encodes WPA, hidden and open networks', () => {
    expect(content(wifi())).toBe('WIFI:T:WPA;S:Home;P:password1;;')
    expect(content(wifi({ hidden: true }))).toBe('WIFI:T:WPA;S:Home;P:password1;H:true;;')
    expect(content(wifi({ security: 'nopass', password: 'ignored' }))).toBe('WIFI:T:nopass;S:Home;;')
  })

  it('escapes backslash, semicolon, comma, colon and quote in ssid and password', () => {
    expect(content(wifi({ ssid: 'a;b,c:d"e\\f', password: 'p;w,d:"\\xx' }))).toBe(
      'WIFI:T:WPA;S:a\\;b\\,c\\:d\\"e\\\\f;P:p\\;w\\,d\\:\\"\\\\xx;;',
    )
  })

  it('keeps non-ASCII SSIDs and counts bytes for the 32 byte limit', () => {
    expect(content(wifi({ ssid: 'บ้าน' }))).toContain('S:บ้าน;')
    expect(errors(wifi({ ssid: 'บ'.repeat(11) })).ssid).toMatch(/32 bytes/)
    expect(content(wifi({ ssid: 'บ'.repeat(10) }))).toContain('S:')
    expect(content(wifi({ ssid: 'a'.repeat(32) }))).toContain('S:')
    expect(errors(wifi({ ssid: 'a'.repeat(33) })).ssid).toBeDefined()
  })

  it('validates required ssid and password lengths', () => {
    expect(errors(wifi({ ssid: '' })).ssid).toBeDefined()
    expect(errors(wifi({ password: 'short' })).password).toBeDefined()
    expect(errors(wifi({ password: 'a'.repeat(64) })).password).toBeDefined()
    expect(content(wifi({ password: 'a'.repeat(63) }))).toBeTruthy()
    expect(content(wifi({ security: 'WEP', password: '12345' }))).toContain('T:WEP')
    expect(content(wifi({ security: 'WEP', password: 'a'.repeat(13) }))).toContain('T:WEP')
    expect(errors(wifi({ security: 'WEP', password: '123456' })).password).toBeDefined()
  })

  it('round-trips through parseFields including escapes and non-ASCII', () => {
    for (const fields of [
      wifi(),
      wifi({ hidden: true }),
      wifi({ security: 'nopass', password: '' }),
      wifi({ ssid: 'a;b,c:d"e\\f', password: 'p;w,d:"\\xxxx' }),
      wifi({ ssid: 'บ้าน ☕' }),
    ]) {
      const encoded = content(fields)
      expect(parseFields('wifi', encoded)).toEqual(fields)
    }
    expect(parseFields('wifi', 'not wifi')).toBeNull()
    expect(parseFields('wifi', 'WIFI:T:WPA;P:x;;')).toBeNull()
  })
})

describe('url / app-link', () => {
  it('accepts only http(s) for url and normalises through URL', () => {
    expect(content({ type: 'url', url: 'https://example.com' })).toBe('https://example.com/')
    expect(content({ type: 'url', url: ' example.com/a b ' })).toBe('https://example.com/a%20b')
    expect(content({ type: 'url', url: 'http://example.com:8080/x?y=1' })).toBe('http://example.com:8080/x?y=1')
    expect(errors({ type: 'url', url: 'ftp://example.com' }).url).toBeDefined()
    expect(errors({ type: 'url', url: 'javascript:alert(1)' }).url).toBeDefined()
    expect(errors({ type: 'url', url: '' }).url).toBeDefined()
  })

  it('app-link needs https with a host', () => {
    expect(content({ type: 'app-link', url: 'https://app.example.com/open?id=1' })).toBe('https://app.example.com/open?id=1')
    expect(errors({ type: 'app-link', url: 'http://app.example.com' }).url).toBeDefined()
    expect(errors({ type: 'app-link', url: 'https://' }).url).toBeDefined()
  })

  it('round-trips', () => {
    expect(parseFields('url', 'https://example.com/')).toEqual({ type: 'url', url: 'https://example.com/' })
    expect(parseFields('url', 'myapp://x')).toBeNull()
    expect(parseFields('app-link', 'https://a.example/x')).toEqual({ type: 'app-link', url: 'https://a.example/x' })
    expect(parseFields('app-link', 'http://a.example/x')).toBeNull()
  })
})

describe('text / custom / deep-link', () => {
  it('passes text and custom through and requires non-empty content', () => {
    expect(content({ type: 'text', text: '  hello\nworld ' })).toBe('  hello\nworld ')
    expect(errors({ type: 'text', text: '   ' }).text).toBeDefined()
    expect(content({ type: 'custom', content: 'ANYTHING:goes' })).toBe('ANYTHING:goes')
    expect(errors({ type: 'custom', content: '' }).content).toBeDefined()
    expect(parseFields('text', 'a')).toEqual({ type: 'text', text: 'a' })
    expect(parseFields('custom', 'a')).toEqual({ type: 'custom', content: 'a' })
  })

  it('deep-link follows the Rust validate_uri rule', () => {
    expect(content({ type: 'deep-link', uri: ' myapp://screen/42?a=1&b=2 ' })).toBe('myapp://screen/42?a=1&b=2')
    expect(errors({ type: 'deep-link', uri: '   ' }).uri).toBeDefined()
    expect(errors({ type: 'deep-link', uri: 'bad\nuri' }).uri).toMatch(/control/)
    expect(errors({ type: 'deep-link', uri: `a://${'x'.repeat(4093)}` }).uri).toMatch(/long/)
    expect(content({ type: 'deep-link', uri: `a://${'x'.repeat(4092)}` })).toBeTruthy()
    // 4096 limit is in bytes, like Rust len()
    expect(validateUri('é'.repeat(2049))).toMatch(/long/)
    expect(validateUri('é'.repeat(2048))).toBeNull()
    expect(parseFields('deep-link', 'myapp://x')).toEqual({ type: 'deep-link', uri: 'myapp://x' })
    expect(parseFields('deep-link', '')).toBeNull()
  })
})

describe('email / phone / sms / location', () => {
  it('email encodes subject and body and round-trips', () => {
    expect(content({ type: 'email', address: 'a@b.co', subject: '', body: '' })).toBe('mailto:a@b.co')
    const fields: QrFieldValues = { type: 'email', address: 'a@b.co', subject: 'Hi & bye', body: 'line1\nü' }
    const encoded = content(fields)
    expect(encoded).toBe('mailto:a@b.co?subject=Hi%20%26%20bye&body=line1%0A%C3%BC')
    expect(parseFields('email', encoded)).toEqual(fields)
    expect(errors({ type: 'email', address: 'nope', subject: '', body: '' }).address).toBeDefined()
    expect(parseFields('email', 'https://x')).toBeNull()
  })

  it('phone strips spaces/dashes and enforces 3-20 digits', () => {
    expect(content({ type: 'phone', number: '+66 81-234 5678' })).toBe('tel:+66812345678')
    expect(content({ type: 'phone', number: '0812345678' })).toBe('tel:0812345678')
    expect(errors({ type: 'phone', number: '12' }).number).toBeDefined()
    expect(errors({ type: 'phone', number: '1'.repeat(21) }).number).toBeDefined()
    expect(errors({ type: 'phone', number: '12ab34' }).number).toBeDefined()
    expect(parseFields('phone', 'tel:+66812345678')).toEqual({ type: 'phone', number: '+66812345678' })
    expect(parseFields('phone', 'tel:abc')).toBeNull()
  })

  it('sms encodes SMSTO and round-trips, message may contain colons', () => {
    const fields: QrFieldValues = { type: 'sms', number: '+66812345678', message: 'time: 10:30' }
    expect(content(fields)).toBe('SMSTO:+66812345678:time: 10:30')
    expect(parseFields('sms', content(fields))).toEqual(fields)
    expect(content({ type: 'sms', number: '123', message: '' })).toBe('SMSTO:123:')
    expect(errors({ type: 'sms', number: 'x', message: '' }).number).toBeDefined()
  })

  it('location validates ranges and encodes the label', () => {
    expect(content({ type: 'location', lat: '13.7563', lon: '100.5018', label: '' })).toBe('geo:13.7563,100.5018')
    const fields: QrFieldValues = { type: 'location', lat: '-33.86', lon: '151.2', label: 'Opera House & Co' }
    expect(content(fields)).toBe('geo:-33.86,151.2?q=Opera%20House%20%26%20Co')
    expect(parseFields('location', content(fields))).toEqual(fields)
    expect(errors({ type: 'location', lat: '91', lon: '0', label: '' }).lat).toBeDefined()
    expect(errors({ type: 'location', lat: '0', lon: '-181', label: '' }).lon).toBeDefined()
    expect(errors({ type: 'location', lat: '', lon: 'x', label: '' })).toMatchObject({ lat: expect.any(String), lon: expect.any(String) })
    expect(content({ type: 'location', lat: '90', lon: '180', label: '' })).toBe('geo:90,180')
  })
})

describe('event', () => {
  const timed = (over: Partial<Extract<QrFieldValues, { type: 'event' }>> = {}): QrFieldValues => ({
    type: 'event',
    title: 'Launch, party; fun',
    start: '2026-01-02T10:00:00Z',
    end: '2026-01-02T11:30:00Z',
    allDay: false,
    location: 'Room 1\\2',
    description: 'line1\nline2',
    ...over,
  })

  it('writes CRLF lines with RFC 5545 escaping and UTC times', () => {
    expect(content(timed())).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'SUMMARY:Launch\\, party\\; fun',
        'DTSTART:20260102T100000Z',
        'DTEND:20260102T113000Z',
        'LOCATION:Room 1\\\\2',
        'DESCRIPTION:line1\\nline2',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    )
  })

  it('supports all-day events', () => {
    const encoded = content(timed({ allDay: true, start: '2026-01-02', end: '2026-01-03', location: '', description: '' }))
    expect(encoded).toContain('DTSTART;VALUE=DATE:20260102\r\nDTEND;VALUE=DATE:20260103')
    expect(parseFields('event', encoded)).toMatchObject({ allDay: true, start: '2026-01-02', end: '2026-01-03' })
  })

  it('requires title, valid dates and end after start', () => {
    expect(errors(timed({ title: ' ' })).title).toBeDefined()
    expect(errors(timed({ start: 'nope' })).start).toBeDefined()
    expect(errors(timed({ end: '2026-01-02T10:00:00Z' })).end).toMatch(/after start/)
    expect(errors(timed({ end: '2026-01-01T10:00:00Z' })).end).toMatch(/after start/)
    expect(errors(timed({ allDay: true, start: '2026-01-02', end: '2026-01-02' })).end).toMatch(/after start/)
    expect(errors(timed({ allDay: true, start: '2026-02-30', end: '2026-03-02' })).start).toBeDefined()
  })

  it('round-trips through parseFields (local date-time form)', () => {
    const encoded = content(timed())
    const parsed = parseFields('event', encoded)
    expect(parsed).toMatchObject({ type: 'event', title: 'Launch, party; fun', location: 'Room 1\\2', description: 'line1\nline2', allDay: false })
    expect(content(parsed as QrFieldValues)).toBe(encoded)
    expect(parseFields('event', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBeNull()
  })
})

describe('contact', () => {
  const contact: QrFieldValues = {
    type: 'contact', firstName: 'Ann', lastName: 'Lee; Jr', phone: '+66 81', email: 'ann@x.co', org: 'A, B', url: 'https://x.co',
  }

  it('writes vCard 3.0 with escaping and CRLF', () => {
    expect(content(contact)).toBe(
      [
        'BEGIN:VCARD', 'VERSION:3.0', 'N:Lee\\; Jr;Ann;;;', 'FN:Ann Lee\\; Jr', 'TEL:+66 81',
        'EMAIL:ann@x.co', 'ORG:A\\, B', 'URL:https://x.co', 'END:VCARD',
      ].join('\r\n'),
    )
  })

  it('validates and round-trips', () => {
    expect(errors({ ...contact, firstName: '', lastName: '' }).firstName).toBeDefined()
    expect(errors({ ...contact, email: 'bad' }).email).toBeDefined()
    expect(errors({ ...contact, url: 'not a url' }).url).toBeDefined()
    expect(parseFields('contact', content(contact))).toEqual(contact)
    const minimal: QrFieldValues = { type: 'contact', firstName: 'Ann', lastName: '', phone: '', email: '', org: '', url: '' }
    expect(parseFields('contact', content(minimal))).toEqual(minimal)
    expect(parseFields('contact', 'plain')).toBeNull()
  })
})

describe('detectType', () => {
  it.each<[string, QrContentType]>([
    ['WIFI:T:WPA;S:x;;', 'wifi'],
    ['BEGIN:VCARD\r\nEND:VCARD', 'contact'],
    ['BEGIN:VCALENDAR\r\nEND:VCALENDAR', 'event'],
    ['mailto:a@b.co', 'email'],
    ['tel:+123456', 'phone'],
    ['SMSTO:123:hi', 'sms'],
    ['sms:123?body=hi', 'sms'],
    ['geo:1,2', 'location'],
    ['https://example.com', 'url'],
    ['myapp://screen', 'deep-link'],
    ['just words', 'text'],
  ])('%s -> %s', (value, expected) => {
    expect(detectType(value)).toBe(expected)
  })
})

describe('estimateQrCapacity', () => {
  it('uses byte length against the per-level limits', () => {
    expect(estimateQrCapacity('a'.repeat(2953), 'L')).toMatchObject({ bytes: 2953, limit: 2953, fits: true })
    expect(estimateQrCapacity('a'.repeat(2954), 'L').fits).toBe(false)
    expect(estimateQrCapacity('a'.repeat(2331), 'M').fits).toBe(true)
    expect(estimateQrCapacity('a'.repeat(2332), 'M').fits).toBe(false)
    expect(estimateQrCapacity('a'.repeat(1663), 'Q').fits).toBe(true)
    expect(estimateQrCapacity('a'.repeat(1664), 'Q').fits).toBe(false)
    expect(estimateQrCapacity('a'.repeat(1273), 'H').fits).toBe(true)
    expect(estimateQrCapacity('a'.repeat(1274), 'H').fits).toBe(false)
    expect(estimateQrCapacity('บ'.repeat(425), 'H')).toMatchObject({ bytes: 1275, fits: false })
    expect(estimateQrCapacity('a'.repeat(1000), 'H').ratio).toBeCloseTo(1000 / 1273)
  })
})

describe('smsToViewUri (design 6.1)', () => {
  it('builds an sms: URI with an encoded body', () => {
    expect(smsToViewUri('SMSTO:+66812345678:hello world')).toBe('sms:+66812345678?body=hello%20world')
  })

  it('omits the query for an empty message', () => {
    expect(smsToViewUri('SMSTO:0812345678:')).toBe('sms:0812345678')
    expect(smsToViewUri('SMSTO:0812345678')).toBe('sms:0812345678')
  })

  it('splits on the first colon after the number and encodes : & and non-ASCII', () => {
    expect(smsToViewUri('SMSTO:123:a:b&c=d สวัสดี')).toBe(
      `sms:123?body=${encodeURIComponent('a:b&c=d สวัสดี')}`,
    )
  })

  it('rejects invalid numbers and non-SMSTO content', () => {
    for (const bad of ['SMSTO:12:hi', 'SMSTO:abc:hi', 'SMSTO::hi', `SMSTO:${'1'.repeat(21)}:hi`, 'SMSTO:+12 34:hi', 'sms:123', 'hello', '']) {
      expect(smsToViewUri(bad)).toBeNull()
    }
    expect(smsToViewUri('SMSTO:123:hi')).not.toBeNull()
    expect(smsToViewUri(`SMSTO:${'1'.repeat(20)}:hi`)).not.toBeNull()
  })
})

describe('launchableUri', () => {
  it('returns the URI for link-like types', () => {
    expect(launchableUri('https://x.co/', 'url')).toBe('https://x.co/')
    expect(launchableUri({ content: 'myapp://a?b=1&c=2', contentType: 'deep-link' })).toBe('myapp://a?b=1&c=2')
    expect(launchableUri('https://a.example', 'app-link')).toBe('https://a.example')
    expect(launchableUri('mailto:a@b.co', 'email')).toBe('mailto:a@b.co')
    expect(launchableUri('tel:+123456', 'phone')).toBe('tel:+123456')
    expect(launchableUri('geo:1,2', 'location')).toBe('geo:1,2')
    expect(launchableUri('SMSTO:123:hi there', 'sms')).toBe('sms:123?body=hi%20there')
  })

  it('returns null for non-launchable types, invalid sms and mismatched content', () => {
    for (const type of ['wifi', 'contact', 'event', 'text', 'custom'] as const) {
      expect(launchableUri('https://x.co', type)).toBeNull()
    }
    expect(launchableUri('SMSTO:1:hi', 'sms')).toBeNull()
    expect(launchableUri('not a url', 'url')).toBeNull()
    expect(launchableUri('https://x.co')).toBeNull()
    expect(launchableUri('https://x.co/\nreboot', 'url')).toBeNull()
  })
})
