import type { ReactNode } from 'react'
import { useLanguage } from '../i18n'
import s from './student.module.css'

type Glyph =
  | 'arrow'
  | 'book'
  | 'calendar'
  | 'search'
  | 'close'
  | 'chevron'
  | 'expand'
  | 'shrink'
  | 'panel'
  | 'grid'
const glyphs: Record<Glyph, ReactNode> = {
  arrow: (
    <>
      <path d="M4 12h15m-6-6 6 6-6 6" />
    </>
  ),
  book: (
    <>
      <path d="M12 5.4c-2.8-2-6.1-2-9-1v14.3c3-1.2 6.1-1.1 9 1.1 2.9-2.2 6-2.3 9-1.1V4.4c-2.9-1-6.2-1-9 1Z" />
      <path d="M12 5.4v14.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.3" width="17" height="16" rx="1.5" />
      <path d="M7.5 2.8v5m9-5v5m-13 2.3h17M8 14h1m4 0h1m-6 3.4h1" />
    </>
  ),
  search: (
    <>
      <circle cx="10.4" cy="10.4" r="6.9" />
      <path d="m15.6 15.6 5 5" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m5 14.5 7-7 7 7" />,
  expand: <path d="M3.5 9V3.5H9m6 0h5.5V9m0 6v5.5H15m-6 0H3.5V15" />,
  shrink: <path d="M9 3v6H3m12-6v6h6m0 6h-6v6m-6 0v-6H3" />,
  panel: (
    <>
      <rect x="2.8" y="4.5" width="18.4" height="15" rx="1.7" />
      <path d="M9 4.5v15" />
    </>
  ),
  grid: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
      <path d="M3.5 9h17M9 9v11" />
    </>
  ),
}

export function Icon({ name, size = 20 }: { name: Glyph; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {glyphs[name]}
    </svg>
  )
}

export function Brand({ teacher = false, href = '/' }: { teacher?: boolean; href?: string }) {
  const { t } = useLanguage()
  return (
    <a className={s.brand} href={href}>
      <span className={s.mark} aria-hidden="true" />
      {teacher ? t('教学管理', 'Teacher admin') : t('程序研习录', 'Capstone Studio')}
    </a>
  )
}

export function errorText(value: unknown) {
  return value instanceof Error ? value.message : '连接中断，请检查网络后刷新。'
}
