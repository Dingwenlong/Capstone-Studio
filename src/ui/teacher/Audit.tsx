import { useState } from 'react'
import { Button, NativeSelect, Table } from '@mantine/core'
import { RefreshCw } from 'lucide-react'
import type { Audit as Event } from '../../shared/contract'
import { read } from '../client'
import { useLanguage } from '../i18n'
import { Loading, matches, SearchBox, useRemote } from './common'
import s from './Teacher.module.css'

const names: Record<string, [string, string]> = {
  createGallery: ['建立系统相册', 'Create gallery'],
  updateGallery: ['修改系统资料', 'Update system details'],
  addScreenshot: ['上传截图', 'Upload screenshot'],
  updateScreenshot: ['修改截图信息', 'Edit screenshot'],
  moveScreenshot: ['调整截图顺序', 'Reorder screenshot'],
  removeScreenshot: ['删除截图', 'Delete screenshot'],
  login: ['登录', 'Sign in'],
  demoLogin: ['示例登录', 'Demo sign-in'],
  logout: ['退出', 'Sign out'],
  launch: ['打开系统', 'Open system'],
  createStudent: ['创建学生账号', 'Create student account'],
  setStudentActive: ['调整账号状态', 'Change account status'],
  resetPassword: ['重置密码', 'Reset password'],
  registerSystem: ['登记演示系统', 'Register system'],
  setSystemEnabled: ['调整上下架状态', 'Change publication status'],
  setGrants: ['保存系统授权', 'Save system access'],
  borrow: ['借阅图书', 'Borrow book'],
  returnBook: ['归还图书', 'Return book'],
  reserve: ['预约实验室', 'Reserve lab'],
  cancelReservation: ['取消预约', 'Cancel reservation'],
}
function detailText(event: Event, lang: 'zh-CN' | 'en') {
  if (lang !== 'en') return event.detail
  if (event.action === 'setStudentActive')
    return event.detail.replace(/^启用 /, 'Enabled ').replace(/^停用 /, 'Disabled ')
  if (event.action === 'setSystemEnabled')
    return event.detail.replace(/^上架 /, 'Published ').replace(/^下架 /, 'Unpublished ')
  if (event.action === 'setGrants') return event.detail.replace(/ → 无$/, ' → None').replaceAll('、', ', ')
  return event.detail
}
const loadAudit = () => read<Event[]>('audit')
const dateOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
}
const dateFormats = {
  'zh-CN': new Intl.DateTimeFormat('zh-CN', dateOptions),
  en: new Intl.DateTimeFormat('en', dateOptions),
}
function formatDate(value: string, lang: 'zh-CN' | 'en') {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateFormats[lang].format(date)
}

export default function Audit() {
  const { t, lang } = useLanguage()
  const actionName = (id: string) => (names[id] ? t(...names[id]) : id)
  const { data, error, reload } = useRemote(loadAudit)
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')
  const actions = [...new Set((data ?? []).map((item) => item.action))]
  const events = (data ?? []).filter(
    (item) =>
      (!action || action === item.action) &&
      matches(query, item.actor, actionName(item.action), detailText(item, lang), item.detail),
  )
  return (
    <>
      <div className={s.heading}>
        <h1>{t('操作记录', 'Activity log')}</h1>
        <Button variant="outline" onClick={reload} leftSection={<RefreshCw size={16} aria-hidden />} >
          {t('刷新', 'Refresh')}
        </Button>
      </div>
      <div className={s.toolRow}>
        <SearchBox
          label={t('搜索账号、操作或对象', 'Search accounts, actions or details')}
          value={query}
          set={setQuery}
        />
        <NativeSelect
          className={s.filter}
          aria-label={t('操作类型', 'Action type')}
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="">{t('全部操作', 'All actions')}</option>
          {actions.map((id) => (
            <option key={id} value={id}>
              {actionName(id)}
            </option>
          ))}
        </NativeSelect>
        <span className={s.subtle}>{t('最近 150 条', 'Latest 150 entries')}</span>
      </div>
      {error || !data ? (
        <Loading error={error} retry={reload} />
      ) : (
        <div className={s.tableBox}>
          <Table className={s.table}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('时间', 'Time')}</Table.Th>
                <Table.Th>{t('操作账号', 'Account')}</Table.Th>
                <Table.Th>{t('操作', 'Action')}</Table.Th>
                <Table.Th>{t('对象或详情', 'Target or details')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {events.map((item) => (
                <Table.Tr key={item.id}>
                  <Table.Td>
                    <time dateTime={item.at}>{formatDate(item.at, lang)}</time>
                  </Table.Td>
                  <Table.Td className={s.mono}>{item.actor}</Table.Td>
                  <Table.Td>{actionName(item.action)}</Table.Td>
                  <Table.Td>{detailText(item, lang) || '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {!events.length && (
            <p className={s.empty}>
              {data.length
                ? t('没有匹配的操作记录。', 'No matching activity.')
                : t('暂无操作记录。', 'No activity yet.')}
            </p>
          )}
        </div>
      )}
    </>
  )
}
