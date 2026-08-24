import { usePackageIcon } from '../../hooks/usePackageIcon'
import { packageDisplayName } from '../../utils/appManagerView'

export function AppIcon({ serial, packageName, customPath, eager = false }: { serial: string; packageName: string; customPath?: string; eager?: boolean }) {
  // Extracting an installed icon requires pulling its base APK. Only the
  // selected row/inspector opts in so merely scrolling never pulls every app.
  const { dataUrl } = usePackageIcon({ serial, packageName, customPath, enabled: eager })
  return (
    <span className="flex h-10 w-10 shrink-0">
      {dataUrl ? <img src={dataUrl} alt="" loading="lazy" className="h-10 w-10 rounded-xl border border-white/5 object-cover" /> : <AppGlyph packageName={packageName} />}
    </span>
  )
}

export function AppGlyph({ packageName }: { packageName: string }) {
  const palettes = ['bg-sky-500/20 text-sky-300', 'bg-violet-500/20 text-violet-300', 'bg-emerald-500/20 text-emerald-300', 'bg-amber-500/20 text-amber-300', 'bg-rose-500/20 text-rose-300']
  const hash = [...packageName].reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/5 text-[13px] font-bold ${palettes[hash % palettes.length]}`}>{packageDisplayName(packageName).slice(0, 1)}</span>
}
