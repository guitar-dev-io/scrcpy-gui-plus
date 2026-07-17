import { Github, Youtube, Globe, Heart, Coffee } from 'lucide-react'
import { useI18n } from '../i18n'

export default function Footer({ version }: { version: string }) {
  const { t } = useI18n()
  return (
    <footer className="w-full px-4 py-3 mt-4 glass border-t border-zinc-800 bg-zinc-900/80 backdrop-blur-md flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-zinc-600">
      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
        {t('footer.aboutScrcpyGui')}
      </span>

      <span className="hidden sm:inline text-zinc-800">•</span>

      <div className="flex items-center gap-3">
        <a
          href="https://github.com/kil0bit-kb"
          target="_blank"
          rel="noopener noreferrer"
          title={t('footer.github')}
          aria-label={t('footer.github')}
          className="text-zinc-600 hover:text-white transition-colors"
        >
          <Github size={14} />
        </a>
        <a
          href="https://www.youtube.com/@kilObit"
          target="_blank"
          rel="noopener noreferrer"
          title={t('footer.youtube')}
          aria-label={t('footer.youtube')}
          className="text-zinc-600 hover:text-white transition-colors"
        >
          <Youtube size={14} />
        </a>
        <a
          href="https://kil0bit.blogspot.com/"
          target="_blank"
          rel="noopener noreferrer"
          title={t('footer.website')}
          aria-label={t('footer.website')}
          className="text-zinc-600 hover:text-white transition-colors"
        >
          <Globe size={14} />
        </a>
        <a
          href="https://www.patreon.com/cw/KB_kilObit"
          target="_blank"
          rel="noopener noreferrer"
          title={t('footer.support')}
          aria-label={t('footer.support')}
          className="text-primary hover:text-primary/80 transition-colors"
        >
          <Coffee size={14} />
        </a>
      </div>

      <span className="hidden sm:inline text-zinc-800">•</span>

      {/* Tech Attributions */}
      <span className="text-[9px] text-zinc-700 hover:text-zinc-500 transition-colors">
        <a
          href="https://github.com/Genymobile/scrcpy"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors"
        >
          scrcpy
        </a>
        {' · '}
        <a
          href="https://tauri.app/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors"
        >
          Tauri
        </a>
        {' · '}
        <a
          href="https://react.dev/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors"
        >
          React
        </a>
        {' · '}
        <a
          href="https://lucide.dev/"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors"
        >
          Lucide
        </a>
      </span>

      <span className="hidden sm:inline text-zinc-800">•</span>

      <span className="text-[10px] text-zinc-600 flex items-center gap-1">
        {t('footer.appVersion', { version })}{' '}
        <Heart size={10} className="text-red-500 fill-red-500" />{' '}
        {t('footer.byKb')}
      </span>
    </footer>
  )
}
