import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { SystemInfo } from '../../shared/contract'
import { read, write } from '../client'
import { useLanguage } from '../i18n'
import { Dialog, Loading, matches, Notice, SearchBox, textValue, useRemote, type Feedback } from './common'
import TeacherGallery from './TeacherGallery'
import s from './Teacher.module.css'
import g from './TeacherGallery.module.css'

const loadSystems = () => read<SystemInfo[]>('catalog')

function ProfileDialog({ system, close, saved }: {
  system: SystemInfo | null
  close: () => void
  saved: (key: string, name: string) => void
}) {
  const { t } = useLanguage()
  return <Dialog
    title={system ? t('编辑系统资料', 'Edit system details') : t('新增系统', 'Add a system')}
    close={close}
    submitLabel={system ? t('保存资料', 'Save details') : t('创建系统', 'Create system')}
    submit={async values => {
      const key = system?.key ?? textValue(values, 'key')
      const name = textValue(values, 'name')
      const platforms = [...new Set(textValue(values, 'platforms').split(/[,，\n]/).map(value => value.trim()).filter(Boolean))]
      await write(system ? 'updateGallery' : 'createGallery', {
        key, name,
        nameEn: textValue(values, 'nameEn'),
        summary: textValue(values, 'summary'),
        summaryEn: textValue(values, 'summaryEn'),
        repository: textValue(values, 'repository'),
        platforms,
      })
      saved(key, name)
    }}
  >
    <label className={s.field}>
      {t('系统标识', 'System key')}
      <input name="key" required={!system} defaultValue={system?.key ?? ''} disabled={Boolean(system)}
        maxLength={32} pattern="[a-z][a-z0-9-]{0,31}" autoCapitalize="none" spellCheck={false}
        title={t('以小写字母开头，可使用小写字母、数字和短横线。', 'Start with a lowercase letter. Use lowercase letters, numbers and hyphens.')} />
    </label>
    <label className={s.field}>{t('系统名称', 'System name')}<input name="name" required maxLength={80} defaultValue={system?.name ?? ''} /></label>
    <label className={s.field}>{t('英文名称', 'English name')}<input name="nameEn" maxLength={120} defaultValue={system?.nameEn ?? ''} /></label>
    <label className={s.field}>{t('系统简介', 'Description')}<textarea className={g.textarea} name="summary" rows={3} maxLength={2000} defaultValue={system?.summary ?? ''} /></label>
    <label className={s.field}>{t('英文简介', 'English description')}<textarea className={g.textarea} name="summaryEn" rows={3} maxLength={4000} defaultValue={system?.summaryEn ?? ''} /></label>
    <label className={s.field}>
      {t('包含的平台', 'Platforms')}
      <input name="platforms" aria-label={t('包含的平台', 'Platforms')} defaultValue={system?.platforms?.join(', ') ?? ''}
        placeholder={t('客户端, 管理端, 小程序, 桌面', 'Client, Admin, Mini program, Desktop')} />
      <span className={g.help}>{t('多个平台用逗号分隔。', 'Separate platforms with commas.')}</span>
    </label>
    <label className={s.field}>
      {t('项目地址', 'Repository URL')}
      <input type="url" name="repository" maxLength={500} pattern="https://.*" defaultValue={system?.repository ?? ''} placeholder="https://" />
    </label>
  </Dialog>
}

export default function Systems(_props: { demo?: boolean }) {
  const { t, lang } = useLanguage()
  const { data, error, reload } = useRemote(loadSystems, 'catalog')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [profile, setProfile] = useState<{ system: SystemInfo | null } | null>(null)
  const [publication, setPublication] = useState<SystemInfo | null>(null)
  const [selectedKey, setSelectedKey] = useState('')
  const [galleryRevision, setGalleryRevision] = useState(0)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const nameOf = (system: SystemInfo) => lang === 'en' && system.nameEn ? system.nameEn : system.name
  const systems = (data ?? []).filter(system =>
    matches(query, system.name, system.nameEn ?? '', system.key) &&
    (filter === 'all' || system.enabled === (filter === 'enabled')))

  function profileSaved(key: string, name: string) {
    setFeedback({ text: '已保存「' + name + '」的资料。', en: 'Saved the details for ' + name + '.' })
    reload()
    setGalleryRevision(value => value + 1)
    if (!selectedKey) setSelectedKey(key)
  }

  return <>
    {selectedKey ? <TeacherGallery
      systemKey={selectedKey}
      revision={galleryRevision}
      onBack={() => { setSelectedKey(''); setFeedback(null); reload() }}
      onEditProfile={system => setProfile({ system })}
    /> : <>
      <div className={s.heading}>
        <h1>{t('系统资料', 'System galleries')}</h1>
        <button className={s.primary} disabled={!data || Boolean(error)} onClick={() => { setFeedback(null); setProfile({ system: null }) }}>
          <Plus size={17} aria-hidden />{t('新增系统', 'Add system')}
        </button>
      </div>
      <Notice feedback={feedback} />
      <div className={s.toolRow}>
        <SearchBox label={t('搜索系统名称或标识', 'Search names or system keys')} value={query} set={setQuery} />
        <select className={s.filter} value={filter} aria-label={t('上架状态', 'Publication status')} onChange={event => setFilter(event.target.value)}>
          <option value="all">{t('全部状态', 'All statuses')}</option>
          <option value="enabled">{t('已上架', 'Published')}</option>
          <option value="disabled">{t('已下架', 'Unpublished')}</option>
        </select>
      </div>
      {error || !data ? <Loading error={error} retry={reload} /> : <div className={s.tableBox}>
        <table className={s.table}>
          <thead><tr>
            <th>{t('系统名称', 'System name')}</th><th>{t('截图', 'Screenshots')}</th>
            <th>{t('状态', 'Status')}</th><th>{t('操作', 'Actions')}</th>
          </tr></thead>
          <tbody>{systems.map(system => <tr key={system.key}>
            <td><strong className={g.systemTitle}>{nameOf(system)}</strong><span className={g.systemKey}>{system.key}</span></td>
            <td>{system.imageCount ?? 0}</td>
            <td><span className={system.enabled ? s.online : s.offline}>{system.enabled ? t('已上架', 'Published') : t('已下架', 'Unpublished')}</span></td>
            <td><div className={s.cellActions}>
              <button className={s.textButton} onClick={() => { setFeedback(null); setSelectedKey(system.key) }}>{t('管理截图', 'Manage screenshots')}</button>
              <button className={s.textButton} onClick={() => setProfile({ system })}>{t('编辑资料', 'Edit details')}</button>
              <button className={s.textButton} onClick={() => { setFeedback(null); setPublication(system) }}>{system.enabled ? t('下架', 'Unpublish') : t('上架', 'Publish')}</button>
            </div></td>
          </tr>)}</tbody>
        </table>
        {!systems.length && <p className={s.empty}>{data.length ? t('没有匹配的系统。', 'No matching systems.') : t('还没有系统资料。', 'No system galleries yet.')}</p>}
      </div>}
    </>}
    {profile && <ProfileDialog system={profile.system} close={() => setProfile(null)} saved={profileSaved} />}
    {publication && <Dialog
      title={publication.enabled ? t('下架系统', 'Unpublish system') : t('上架系统', 'Publish system')}
      close={() => setPublication(null)}
      submitLabel={publication.enabled ? t('下架', 'Unpublish') : t('上架', 'Publish')}
      submit={async () => {
        await write('setSystemEnabled', { key: publication.key, enabled: !publication.enabled })
        setFeedback({
          text: '已' + (publication.enabled ? '下架' : '上架') + '「' + publication.name + '」。',
          en: (publication.enabled ? 'Unpublished ' : 'Published ') + (publication.nameEn || publication.name) + '.',
        })
        reload()
      }}
    ><p className={s.dialogHelp}>{publication.enabled
        ? t('下架后，学生将无法查看此系统的截图。', 'Students will lose access to this system’s screenshots.')
        : t('上架后，已获授权的学生可以查看此系统的截图。', 'Students with access will be able to view this system’s screenshots.')}</p></Dialog>}
  </>
}
