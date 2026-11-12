import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { SystemInfo, Target } from '../../shared/contract'
import { read, write } from '../client'
import { useLanguage } from '../i18n'
import {
  Dialog,
  Loading,
  matches,
  Notice,
  SearchBox,
  textValue,
  useRemote,
  systemName,
  type Feedback,
} from './common'
import s from './Teacher.module.css'

async function loadSystems() {
  const [catalog, targets] = await Promise.all([read<SystemInfo[]>('catalog'), read<Target[]>('targets')])
  return { catalog, targets }
}

function Registration({
  demo,
  targets,
  close,
  saved,
}: {
  demo: boolean
  targets: Target[]
  close: () => void
  saved: (name: string) => void
}) {
  const { t, lang } = useLanguage()
  const [key, setKey] = useState(targets[0]?.key ?? '')
  const [name, setName] = useState(targets[0]?.name ?? '')
  return (
    <Dialog
      title={t('登记演示系统', 'Register a demo system')}
      close={close}
      canSubmit={targets.length > 0}
      submitLabel={t('登记系统', 'Register system')}
      submit={async (values) => {
        const displayName = textValue(values, 'name')
        await write('registerSystem', { key, name: displayName })
        saved(displayName)
      }}
    >
      {targets.length ? (
        <>
          <label className={s.field}>
            {t('部署目标', 'Deployment target')}
            <select
              value={key}
              onChange={(e) => {
                setKey(e.target.value)
                setName(targets.find((item) => item.key === e.target.value)?.name ?? '')
              }}
            >
              {targets.map((target) => (
                <option key={target.key} value={target.key}>
                  {systemName(target, lang)} · {target.key}
                </option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            {t('显示名称', 'Display name')}
            <input
              name="name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        </>
      ) : (
        <p className={s.dialogHelp}>
          {demo
            ? t(
                '示例空间只开放图书借阅和实验室预约，两个系统均已登记。',
                'This demo workspace includes the Library and Lab reservations systems. Both are already registered.',
              )
            : t(
                '没有可登记的部署目标。请先在部署清单中加入新系统，再回到这里登记。',
                'No deployment targets are available. Add a system to the deployment manifest, then return here to register it.',
              )}
        </p>
      )}
    </Dialog>
  )
}

export default function Systems({ demo = false }: { demo?: boolean }) {
  const { t, lang } = useLanguage()
  const { data, error, reload } = useRemote(loadSystems, 'catalog')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [register, setRegister] = useState(false)
  const [editing, setEditing] = useState<SystemInfo | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const systems = (data?.catalog ?? []).filter(
    (item) =>
      matches(query, systemName(item, lang), item.name, item.key) &&
      (filter === 'all' || item.enabled === (filter === 'enabled')),
  )
  const keys = new Set(data?.catalog.map((item) => item.key))
  const available = data?.targets.filter((item) => !keys.has(item.key)) ?? []
  return (
    <>
      <div className={s.heading}>
        <h1>{t('演示系统', 'Demo systems')}</h1>
        <button
          className={s.primary}
          disabled={!data || Boolean(error)}
          onClick={() => {
            setFeedback(null)
            setRegister(true)
          }}
        >
          <Plus size={17} aria-hidden />
          {t('登记系统', 'Register system')}
        </button>
      </div>
      <Notice feedback={feedback} />
      <div className={s.toolRow}>
        <SearchBox
          label={t('搜索系统名称或标识', 'Search names or system keys')}
          value={query}
          set={setQuery}
        />
        <select
          className={s.filter}
          value={filter}
          aria-label={t('上架状态', 'Publication status')}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">{t('全部状态', 'All statuses')}</option>
          <option value="enabled">{t('已上架', 'Published')}</option>
          <option value="disabled">{t('已下架', 'Unpublished')}</option>
        </select>
      </div>
      {error || !data ? (
        <Loading error={error} retry={reload} />
      ) : (
        <div className={s.tableBox}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>{t('系统名称', 'System name')}</th>
                <th>{t('部署标识', 'Deployment key')}</th>
                <th>{t('状态', 'Status')}</th>
                <th>{t('操作', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {systems.map((item) => (
                <tr key={item.key}>
                  <td>{systemName(item, lang)}</td>
                  <td className={s.mono}>{item.key}</td>
                  <td>
                    <span className={item.enabled ? s.online : s.offline}>
                      {item.enabled ? t('已上架', 'Published') : t('已下架', 'Unpublished')}
                    </span>
                  </td>
                  <td>
                    <button
                      className={s.textButton}
                      onClick={() => {
                        setFeedback(null)
                        setEditing(item)
                      }}
                    >
                      {item.enabled ? t('下架', 'Unpublish') : t('上架', 'Publish')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!systems.length && (
            <p className={s.empty}>
              {data.catalog.length
                ? t('没有匹配的演示系统。', 'No matching systems.')
                : t('还没有登记演示系统。', 'No demo systems registered yet.')}
            </p>
          )}
        </div>
      )}
      {register && (
        <Registration
          demo={demo}
          targets={available}
          close={() => setRegister(false)}
          saved={(name) => {
            setFeedback({ text: `已登记「${name}」。`, en: `Registered ${name}.` })
            reload()
          }}
        />
      )}
      {editing && (
        <Dialog
          title={
            editing.enabled ? t('下架演示系统', 'Unpublish system') : t('上架演示系统', 'Publish system')
          }
          close={() => setEditing(null)}
          submitLabel={editing.enabled ? t('下架系统', 'Unpublish') : t('上架系统', 'Publish')}
          submit={async () => {
            await write('setSystemEnabled', { key: editing.key, enabled: !editing.enabled })
            setFeedback({
              text: `已${editing.enabled ? '下架' : '上架'}「${editing.name}」。`,
              en: `${editing.enabled ? 'Unpublished' : 'Published'} ${systemName(editing, 'en')}.`,
            })
            reload()
          }}
        >
          <p className={s.dialogHelp}>
            {editing.enabled
              ? t(
                  `下架后，学生将无法进入「${editing.name}」。`,
                  `Students will lose access to ${systemName(editing, 'en')}.`,
                )
              : t(
                  `上架后，已获授权的学生可以进入「${editing.name}」。`,
                  `Students with access will be able to open ${systemName(editing, 'en')}.`,
                )}
          </p>
        </Dialog>
      )}
    </>
  )
}
