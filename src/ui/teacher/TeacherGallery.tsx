import { useCallback, useEffect, useRef, useState } from 'react'
import { Badge, Button, NativeSelect, TextInput, UnstyledButton } from '@mantine/core'
import { ArrowLeft, ArrowDown, ArrowUp, ImagePlus, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import type { Gallery, Screenshot, SystemInfo } from '../../shared/contract'
import { localizeMessage } from '../../shared/i18n'
import { read, uploadScreenshot, write } from '../client'
import { useLanguage } from '../i18n'
import { galleryName, groupLabel, ScreenshotViewer, screenshotUrl } from '../gallery/Gallery'
import { Dialog, Loading, message, Notice, textValue, useRemote, type Feedback } from './common'
import s from './Teacher.module.css'
import g from './TeacherGallery.module.css'

type UploadItem = {
  id: string
  file: File
  status: 'queued' | 'uploading' | 'done' | 'failed' | 'unknown' | 'invalid'
  problem?: 'type' | 'size'
  error?: string
}
type Edit = { kind: 'image'; image: Screenshot } | { kind: 'remove'; image: Screenshot } |
  { kind: 'group'; group: string; images: Screenshot[]; updated: number }

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? Math.ceil(bytes / 1024) + ' KiB' : (bytes / (1024 * 1024)).toFixed(1) + ' MiB'
}

export default function TeacherGallery({ systemKey, revision, onBack, onEditProfile }: {
  systemKey: string
  revision: number
  onBack: () => void
  onEditProfile: (system: SystemInfo) => void
}) {
  const { t, lang } = useLanguage()
  const load = useCallback(() => read<Gallery>('gallery', { systemKey }), [systemKey, revision])
  const { data, error, reload } = useRemote(load, 'gallery')
  const [group, setGroup] = useState('')
  const [uploadGroup, setUploadGroup] = useState('Client')
  const [queue, setQueue] = useState<UploadItem[]>([])
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const lock = useRef(false)
  const mounted = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const renamedGroup = useRef<string | null>(null)
  const groups = [...new Set(data?.images.map(image => image.group) ?? [])]
  const images = (data?.images ?? []).filter(image => !group || image.group === group)
  const pending = queue.filter(item => item.status === 'queued')
  const uploadSuggestions = [...new Set([...groups, 'Client', 'Admin', 'Mini program', 'Desktop'])]

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (data && renamedGroup.current && data.images.some(image => image.group === renamedGroup.current)) {
      setGroup(renamedGroup.current)
      renamedGroup.current = null
    } else if (data && group && !data.images.some(image => image.group === group)) setGroup('')
    if (selectedId && data && !data.images.some(image => image.id === selectedId)) setSelectedId(null)
  }, [data, group, selectedId])
  useEffect(() => {
    if (!busy) return
    const leaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', leaving)
    return () => window.removeEventListener('beforeunload', leaving)
  }, [busy])

  function enqueue(files: FileList | null) {
    if (!files) return
    const additions: UploadItem[] = Array.from(files).map(file => {
      const problem = !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
        ? 'type' : file.size > 8 * 1024 * 1024 ? 'size' : undefined
      return { id: crypto.randomUUID(), file, status: problem ? 'invalid' : 'queued', problem }
    })
    setQueue(current => [...current, ...additions])
    if (fileInput.current) fileInput.current.value = ''
  }

  function updateUpload(id: string, patch: Partial<UploadItem>) {
    if (mounted.current) setQueue(current => current.map(item => item.id === id ? { ...item, ...patch } : item))
  }

  async function sendUploads(items: UploadItem[]) {
    if (lock.current || !uploadGroup.trim() || !items.length) return
    lock.current = true
    setBusy(true)
    setFeedback(null)
    const destination = uploadGroup.trim()
    try {
      for (const item of items) {
        if (!mounted.current) break
        updateUpload(item.id, { status: 'uploading', error: undefined })
        try {
          await uploadScreenshot(item.file, {
            systemKey, group: destination,
            title: item.file.name.replace(/\.[^.]+$/, '').trim().slice(0, 120) || t('截图', 'Screenshot'),
          })
          updateUpload(item.id, { status: 'done' })
        } catch (cause) {
          const hasStatus = cause instanceof Error && 'status' in cause && typeof cause.status === 'number'
          updateUpload(item.id, { status: hasStatus ? 'failed' : 'unknown', error: message(cause) })
        }
        if (mounted.current) reload()
      }
    } finally {
      lock.current = false
      if (mounted.current) { setBusy(false); reload() }
    }
  }

  async function move(image: Screenshot, direction: 'up' | 'down') {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setFeedback(null)
    try {
      await write('moveScreenshot', { id: image.id, direction })
      reload()
    } catch (cause) {
      setFeedback({ text: message(cause), error: true })
      reload()
    } finally { lock.current = false; setBusy(false) }
  }

  async function saveEdit(values: FormData) {
    if (!edit || lock.current) return
    lock.current = true
    setBusy(true)
    setFeedback(null)
    try {
      if (edit.kind === 'remove') {
        await write('removeScreenshot', { id: edit.image.id })
      } else if (edit.kind === 'image') {
        await write('updateScreenshot', {
          id: edit.image.id, title: textValue(values, 'title'), group: textValue(values, 'group'),
        })
      } else {
        const newGroup = textValue(values, 'group')
        const remaining = [...edit.images]
        for (const image of edit.images) {
          await write('updateScreenshot', { id: image.id, title: image.title, group: newGroup })
          remaining.shift()
          setEdit(current => current?.kind === 'group' ? { ...current, images: [...remaining], updated: current.updated + 1 } : current)
        }
        renamedGroup.current = newGroup
      }
      setFeedback({ text: '截图资料已更新。', en: 'Screenshot details updated.' })
    } finally {
      lock.current = false
      setBusy(false)
      reload()
    }
  }

  function uploadStatus(item: UploadItem) {
    if (item.problem === 'type') return t('请选择 PNG、JPEG 或 WebP 图片。', 'Choose a PNG, JPEG or WebP image.')
    if (item.problem === 'size') return t('文件超过 8 MiB。', 'File exceeds 8 MiB.')
    if (item.status === 'unknown') return t('结果待核对，请刷新列表检查是否已上传。', 'Result unconfirmed. Refresh the gallery to check whether the image was uploaded.')
    if (item.error) return localizeMessage(item.error, lang)
    const labels = {
      queued: t('等待上传', 'Ready to upload'), uploading: t('上传中…', 'Uploading…'),
      done: t('已上传', 'Uploaded'), failed: t('上传失败', 'Upload failed'), invalid: '',
    }
    return labels[item.status]
  }

  return <section className={g.manager}>
    <Button variant="subtle" size="compact-sm" disabled={busy} onClick={onBack} leftSection={<ArrowLeft size={18} aria-hidden />}>{t('返回系统列表', 'Back to systems')}</Button>
    {error || !data ? <Loading error={error} retry={reload} /> : <>
      <header className={g.managerHeading}>
        <div><h1>{galleryName(data.system, lang)}</h1><p className={g.summary}>
          {lang === 'en' && data.system.summaryEn ? data.system.summaryEn : data.system.summary}
        </p></div>
        <Button variant="outline" disabled={busy} onClick={() => onEditProfile(data.system)} leftSection={<Pencil size={16} aria-hidden />}>{t('编辑资料', 'Edit details')}</Button>
      </header>
      <div className={g.meta}>
        <span>{t('共 ', '')}{data.images.length}{t(' 张截图', ' screenshots')}</span>
        <span>{formatSize(data.system.storageBytes ?? data.images.reduce((sum, image) => sum + image.bytes, 0))}</span>
        <Badge tt="none" fw={500} variant="light" color={data.system.enabled ? 'pine' : 'gray'} className={data.system.enabled ? s.online : s.offline}>{data.system.enabled ? t('已上架', 'Published') : t('已下架', 'Unpublished')}</Badge>
      </div>
      <Notice feedback={feedback} />
      <section className={g.uploadBox} aria-label={t('上传截图', 'Upload screenshots')}>
        <div className={g.uploadControls}>
          <TextInput className={g.uploadGroup} label={t('上传到分组', 'Upload to group')}
            required maxLength={80} list="gallery-upload-groups" value={uploadGroup} disabled={busy}
            onChange={event => setUploadGroup(event.currentTarget.value)} />
          <datalist id="gallery-upload-groups">{uploadSuggestions.map(value => <option key={value} value={value} label={groupLabel(value, lang)} />)}</datalist>
          <input ref={fileInput} className={g.fileInput} type="file" multiple accept="image/png,image/jpeg,image/webp"
            aria-label={t('选择截图文件', 'Choose screenshot files')} disabled={busy} onChange={event => enqueue(event.target.files)} />
          <Button variant="outline" disabled={busy} onClick={() => fileInput.current?.click()} leftSection={<ImagePlus size={17} aria-hidden />}>{t('选择图片', 'Choose images')}</Button>
          <Button disabled={busy || !pending.length || !uploadGroup.trim()} onClick={() => void sendUploads(pending)}>
            {busy ? t('处理中…', 'Working…') : t('上传所选图片', 'Upload selected images')}
          </Button>
        </div>
        <p className={g.help}>{t('支持 PNG、JPEG、WebP，每张最大 8 MiB。上传后可以修改名称和分组。', 'PNG, JPEG and WebP, up to 8 MiB per image. You can edit names and groups after uploading.')}</p>
        {queue.length > 0 && <ul className={g.uploadQueue} aria-live="polite">{queue.map(item => <li key={item.id}>
          <div><strong>{item.file.name}</strong><span className={item.status === 'done' ? g.uploadSuccess : item.status === 'failed' || item.status === 'unknown' || item.status === 'invalid' ? g.uploadFailure : g.help}>{uploadStatus(item)}</span></div>
          <div className={g.queueActions}>
            {item.status === 'failed' && <Button variant="subtle" size="compact-sm" disabled={busy} onClick={() => void sendUploads([item])}>{t('重试', 'Retry')}</Button>}
            <Button variant="subtle" size="compact-sm" disabled={busy} onClick={() => setQueue(current => current.filter(value => value.id !== item.id))}>{t('移除记录', 'Dismiss')}</Button>
          </div>
        </li>)}</ul>}
      </section>
      <div className={g.galleryTools}>
        <NativeSelect className={g.groupFilter} label={t('查看分组', 'View group')}
          value={group} disabled={busy} onChange={event => setGroup(event.currentTarget.value)}
          data={[{ value: '', label: t('全部截图', 'All screenshots') }, ...groups.map(value => ({ value, label: groupLabel(value, lang) }))]} />
        {group && <Button variant="subtle" size="compact-sm" disabled={busy} onClick={() => setEdit({ kind: 'group', group, images: [...images], updated: 0 })}>{t('重命名分组', 'Rename group')}</Button>}
        <Button variant="outline" disabled={busy} onClick={reload} leftSection={<RefreshCw size={16} aria-hidden />}>{t('刷新列表', 'Refresh gallery')}</Button>
      </div>
      {!images.length ? <div className={g.empty}>
        <h2>{t('等待补充截图', 'Screenshots to be added')}</h2>
        <p>{t('选择分组并上传实际系统截图。', 'Choose a group and upload screenshots of the system.')}</p>
      </div> : <div className={g.imageList}>
        {images.map(image => {
          const peers = data.images.filter(value => value.group === image.group)
          const position = peers.findIndex(value => value.id === image.id)
          return <article key={image.id} className={g.imageRow}>
            <UnstyledButton className={g.thumbnail} onClick={() => setSelectedId(image.id)} aria-label={t('查看截图 ', 'View screenshot ') + image.title}>
              <img src={screenshotUrl(image, true)} alt={image.title} loading="lazy" />
            </UnstyledButton>
            <div className={g.imageDetails}><h3>{image.title}</h3><p>{groupLabel(image.group, lang)} · {image.width} × {image.height} · {formatSize(image.bytes)}</p>
              <div className={g.imageActions}>
                <Button variant="subtle" size="compact-sm" disabled={busy} onClick={() => setEdit({ kind: 'image', image })} leftSection={<Pencil size={15} aria-hidden />}>{t('编辑', 'Edit')}</Button>
                <Button variant="subtle" size="compact-sm" disabled={busy || position === 0} onClick={() => void move(image, 'up')} aria-label={t('前移 ', 'Move up ') + image.title} leftSection={<ArrowUp size={16} aria-hidden />}>{t('前移', 'Move up')}</Button>
                <Button variant="subtle" size="compact-sm" disabled={busy || position === peers.length - 1} onClick={() => void move(image, 'down')} aria-label={t('后移 ', 'Move down ') + image.title} leftSection={<ArrowDown size={16} aria-hidden />}>{t('后移', 'Move down')}</Button>
                <Button variant="subtle" size="compact-sm" disabled={busy} onClick={() => setEdit({ kind: 'remove', image })} leftSection={<Trash2 size={15} aria-hidden />}>{t('删除', 'Delete')}</Button>
              </div>
            </div>
          </article>
        })}
      </div>}
      <ScreenshotViewer images={images} selectedId={selectedId} onSelect={setSelectedId} onClose={() => setSelectedId(null)} />
    </>}
    {edit && <Dialog
      title={edit.kind === 'remove' ? t('删除截图', 'Delete screenshot') : edit.kind === 'group' ? t('重命名分组', 'Rename group') : t('编辑截图', 'Edit screenshot')}
      close={() => setEdit(null)} submit={saveEdit}
      submitLabel={edit.kind === 'remove' ? t('删除截图', 'Delete screenshot') : t('保存', 'Save')}
    >
      {edit.kind === 'remove' ? <p className={s.dialogHelp}>{t('确定删除「', 'Delete “') + edit.image.title + t('」？', '”?')}</p> : <>
        {edit.kind === 'image' && <TextInput label={t('截图名称', 'Screenshot name')} name="title" required maxLength={120} defaultValue={edit.image.title} />}
        <TextInput label={t('分组名称', 'Group name')} name="group" list="gallery-edit-groups" required maxLength={80} defaultValue={edit.kind === 'image' ? edit.image.group : edit.group} />
        <datalist id="gallery-edit-groups">{uploadSuggestions.map(value => <option key={value} value={value} label={groupLabel(value, lang)} />)}</datalist>
        {edit.kind === 'group' && <p className={s.dialogHelp}>{t('将更新本组 ', 'This will update ')}{edit.images.length}{t(' 张截图的分组。', ' screenshots in this group.')}</p>}
        {edit.kind === 'group' && edit.updated > 0 && <p className={s.dialogHelp}>{t('已完成 ', 'Already updated ')}{edit.updated}{t(' 张，保存可继续处理余下截图。', ' screenshots. Save again to continue with the remaining images.')}</p>}
      </>}
    </Dialog>}
  </section>
}
