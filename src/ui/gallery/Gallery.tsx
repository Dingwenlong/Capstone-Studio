'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ActionIcon, Anchor, Button, Loader, Paper, Text, UnstyledButton } from '@mantine/core'
import { ChevronLeft, ChevronRight, ExternalLink, ImageIcon, Maximize2, Minimize2, Monitor, RefreshCw, Smartphone, X } from 'lucide-react'
import type { Gallery as GalleryData, Screenshot, SystemInfo } from '../../shared/contract'
import { displayLabel, localizeMessage, type Language } from '../../shared/i18n'
import { read } from '../client'
import { useLanguage } from '../i18n'
import s from './Gallery.module.css'

export function galleryName(system: SystemInfo, lang: Language) {
  if (lang === 'en' && system.nameEn) return system.nameEn
  return ['library', 'lab'].includes(system.key) ? displayLabel(system.name, lang) : system.name
}

export function groupLabel(group: string, lang: Language) {
  const labels: Record<string, [string, string]> = {
    '客户端': ['客户端', 'Client'],
    Client: ['客户端', 'Client'],
    '管理端': ['管理端', 'Admin'],
    Admin: ['管理端', 'Admin'],
    '小程序': ['小程序', 'Mini program'],
    'Mini program': ['小程序', 'Mini program'],
    '桌面': ['桌面', 'Desktop'],
    Desktop: ['桌面', 'Desktop'],
  }
  return labels[group]?.[lang === 'en' ? 1 : 0] ?? group
}

export function screenshotUrl(image: Screenshot, thumbnail = false) {
  return '/media/' + encodeURIComponent(image.id) + (thumbnail ? '/thumb' : '')
}

function failureMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : '连接中断，请检查网络后刷新。'
}

function repositoryUrl(value: string | undefined) {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch { return undefined }
}

function Thumbnail({ image, open, refresh }: { image: Screenshot; open: () => void; refresh: () => void }) {
  const { t } = useLanguage()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = () => { setFailed(false); setAttempt(value => value + 1); refresh() }
  return <Paper component="article" withBorder className={s.thumbnail}>
    {failed ? <div className={s.imageError}>
      <ImageIcon size={26} aria-hidden />
      <span>{t('图片暂不可用', 'Image unavailable')}</span>
      <Button variant="subtle" size="compact-sm" className={s.retryButton} onClick={retry}>{t('重试', 'Try again')}</Button>
    </div> : <UnstyledButton className={s.imageButton} onClick={open} aria-label={t('查看截图 ', 'View screenshot ') + image.title}>
      <img src={screenshotUrl(image, true) + (attempt ? '?retry=' + attempt : '')} alt={image.title}
        loading="lazy" decoding="async" width={image.width} height={image.height}
        onError={() => { setFailed(true); refresh() }} />
      <span className={s.expand}><Maximize2 size={16} aria-hidden /></span>
    </UnstyledButton>}
    <Text className={s.caption}>{image.title}</Text>
  </Paper>
}

function ViewerDialog({ images, selectedId, onClose, onSelect }: {
  images: Screenshot[]
  selectedId: string
  onClose: () => void
  onSelect: (id: string) => void
}) {
  const { t, lang } = useLanguage()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [original, setOriginal] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const index = images.findIndex(image => image.id === selectedId)
  const image = images[index]
  useEffect(() => {
    const element = dialog.current
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.showModal()
    return () => {
      element?.close()
      if (trigger?.isConnected) trigger.focus()
    }
  }, [])
  useEffect(() => {
    setOriginal(false)
    setFailed(false)
    setAttempt(0)
  }, [selectedId])
  function move(delta: number) {
    const next = images[index + delta]
    if (next) onSelect(next.id)
  }
  if (!image) return null
  return <dialog ref={dialog} className={s.viewer} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) }
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1) }
    }}>
    <header className={s.viewerHeader}>
      <div><h2 id={titleId}>{image.title}</h2><p>{groupLabel(image.group, lang)} · {index + 1} / {images.length}</p></div>
      <div className={s.viewerActions}>
        <Button variant="subtle" onClick={() => setOriginal(value => !value)} className={s.viewerButton} aria-pressed={original}
          aria-label={original ? t('适应窗口', 'Fit to window') : t('原图', 'Original size')}
          leftSection={original ? <Minimize2 size={18} aria-hidden /> : <Maximize2 size={18} aria-hidden />}
          title={original ? t('适应窗口', 'Fit to window') : t('查看原图', 'Original size')}>
          <span className={s.viewerToggleText}>{original ? t('适应窗口', 'Fit to window') : t('原图', 'Original size')}</span>
        </Button>
        <ActionIcon variant="subtle" onClick={onClose} className={s.viewerButton} aria-label={t('关闭截图', 'Close screenshot')}><X size={23} aria-hidden /></ActionIcon>
      </div>
    </header>
    <div className={s.viewerImage} data-original={original}>
      {failed ? <div className={s.viewerError} role="status">
        <ImageIcon size={32} aria-hidden /><p>{t('图片暂不可用，请重试。', 'This image is unavailable. Try again.')}</p>
        <Button variant="subtle" className={s.viewerButton} onClick={() => { setFailed(false); setAttempt(value => value + 1) }}>{t('重新加载', 'Reload')}</Button>
      </div> : <img key={image.id} src={screenshotUrl(image) + (attempt ? '?retry=' + attempt : '')}
        alt={image.title} width={image.width} height={image.height} onError={() => setFailed(true)} />}
    </div>
    <footer className={s.viewerFooter}>
      <Button variant="subtle" className={s.viewerButton} disabled={index === 0} onClick={() => move(-1)} leftSection={<ChevronLeft size={20} aria-hidden />}>{t('上一张', 'Previous')}</Button>
      <span>{image.width} × {image.height}</span>
      <Button variant="subtle" className={s.viewerButton} disabled={index === images.length - 1} onClick={() => move(1)} rightSection={<ChevronRight size={20} aria-hidden />}>{t('下一张', 'Next')}</Button>
    </footer>
  </dialog>
}

export function ScreenshotViewer({ images, selectedId, onClose, onSelect }: {
  images: Screenshot[]
  selectedId: string | null
  onClose: () => void
  onSelect: (id: string) => void
}) {
  if (!selectedId || !images.some(image => image.id === selectedId)) return null
  return <ViewerDialog images={images} selectedId={selectedId} onClose={onClose} onSelect={onSelect} />
}

export default function Gallery({ system, visible }: { system: SystemInfo; visible: boolean }) {
  const { lang, t } = useLanguage()
  const [data, setData] = useState<GalleryData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [group, setGroup] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sequence = useRef(0)
  const reading = useRef(0)

  const refresh = useCallback(async () => {
    if (reading.current && reading.current === sequence.current) return
    const current = ++sequence.current
    reading.current = current
    try {
      const next = await read<GalleryData>('gallery', { systemKey: system.key })
      if (sequence.current !== current) return
      setData(next)
      setError('')
      setGroup(previous => next.images.some(image => image.group === previous) ? previous : next.images[0]?.group ?? '')
      setSelectedId(previous => next.images.some(image => image.id === previous) ? previous : null)
    } catch (reason) {
      if (sequence.current !== current) return
      setData(null)
      setSelectedId(null)
      setError(failureMessage(reason))
      if ((reason as { status?: number })?.status === 401) window.location.replace('/login')
    } finally {
      if (reading.current === current) reading.current = 0
      if (sequence.current === current) setLoading(false)
    }
  }, [system.key])

  useEffect(() => {
    if (!visible) { setSelectedId(null); return }
    const wake = () => { if (!document.hidden) void refresh() }
    const reconcile = (event: Event) => {
      if ((event as CustomEvent<{ action: string }>).detail?.action === 'gallery') wake()
    }
    void refresh()
    window.addEventListener('focus', wake)
    window.addEventListener('classroom:refresh', reconcile)
    document.addEventListener('visibilitychange', wake)
    const timer = window.setInterval(wake, 15000)
    return () => {
      ++sequence.current
      window.clearInterval(timer)
      window.removeEventListener('focus', wake)
      window.removeEventListener('classroom:refresh', reconcile)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [refresh, visible])

  const info = data?.system ?? system
  const title = galleryName(info, lang)
  const summary = lang === 'en' && info.summaryEn ? info.summaryEn : info.summary
  const images = data?.images ?? []
  const groups = [...new Set(images.map(image => image.group))]
  const shown = images.filter(image => image.group === group)
  const repository = repositoryUrl(info.repository)
  return <section className={s.gallery} hidden={!visible} aria-label={title}>
    <header className={s.galleryHeader}>
      <div><h1>{title}</h1>{summary && <p className={s.summary}>{summary}</p>}
        {!!info.platforms?.length && <ul className={s.platforms} aria-label={t('客户端类型', 'Platforms')}>
          {info.platforms.map(platform => <li key={platform}>{groupLabel(platform, lang)}</li>)}
        </ul>}
      </div>
      {repository && <Anchor className={s.repository} href={repository} target="_blank" rel="noopener noreferrer">
        {t('项目源码', 'Source repository')}<ExternalLink size={15} aria-hidden />
      </Anchor>}
    </header>
    {error ? <div className={s.state}><h2>{t('截图暂不可用', 'Screenshots unavailable')}</h2>
      <p role="alert">{localizeMessage(error, lang)}</p><Button onClick={refresh} leftSection={<RefreshCw size={16} aria-hidden />}>{t('重试', 'Try again')}</Button>
    </div> : loading ? <div className={s.state} role="status"><Loader size="sm" /><Text>{t('正在读取截图…', 'Loading screenshots…')}</Text></div>
      : !images.length ? <div className={s.state}>
        <ImageIcon size={36} strokeWidth={1.3} aria-hidden />
        <h2>{t('截图待补充', 'Screenshots coming soon')}</h2>
        <p>{t('老师上传截图后，可在这里按端查看系统界面。', 'Screenshots will appear here when your teacher uploads them.')}</p>
      </div> : <>
        <div className={s.groups} role="group" aria-label={t('截图分组', 'Screenshot groups')}>
          {groups.map(value => {
            const GroupIcon = /android|ios|mobile|手机|移动|小程序/i.test(value) ? Smartphone : Monitor
            return <Button key={value} variant={group === value ? 'light' : 'outline'}
              className={s.groupButton} aria-pressed={group === value}
              leftSection={<GroupIcon size={20} strokeWidth={1.65} aria-hidden />}
              onClick={() => { setGroup(value); setSelectedId(null) }}>
              {groupLabel(value, lang)}
            </Button>
          })}
        </div>
        <div className={s.grid}>
          {shown.map(image => <Thumbnail key={image.id} image={image} open={() => setSelectedId(image.id)} refresh={refresh} />)}
        </div>
      </>}
    {visible && <ScreenshotViewer images={shown} selectedId={selectedId} onSelect={setSelectedId} onClose={() => setSelectedId(null)} />}
  </section>
}
