import { useState } from 'react'
import { Badge, Button, NativeSelect, Table, TextInput } from '@mantine/core'
import { Plus } from 'lucide-react'
import type { Student } from '../../shared/contract'
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
  studentName,
  type Feedback,
} from './common'
import s from './Teacher.module.css'

type Edit = { kind: 'create' } | { kind: 'password' | 'active'; student: Student }
const loadStudents = () => read<Student[]>('students')

export default function Students({ demo }: { demo: boolean }) {
  const { t, lang } = useLanguage()
  const { data, error, reload } = useRemote(loadStudents, 'students')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [edit, setEdit] = useState<Edit | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const list = (data ?? []).filter(
    (student) =>
      matches(query, studentName(student, lang, demo), student.name, student.username) &&
      (filter === 'all' || student.active === (filter === 'active')),
  )
  function open(next: Edit) {
    setFeedback(null)
    setEdit(next)
  }
  async function save(values: FormData) {
    if (!edit) return
    if (edit.kind === 'create') {
      const name = textValue(values, 'name')
      await write('createStudent', {
        name,
        username: textValue(values, 'username'),
        password: String(values.get('password') ?? ''),
      })
      setFeedback({ text: `已创建学生账号「${name}」。`, en: `Created the account for ${name}.` })
    } else if (edit.kind === 'password') {
      await write('resetPassword', {
        studentId: edit.student.id,
        password: String(values.get('password') ?? ''),
      })
      setFeedback({
        text: `已重置「${edit.student.name}」的密码。`,
        en: `Password reset for ${studentName(edit.student, 'en', demo)}.`,
      })
    } else {
      const active = !edit.student.active
      await write('setStudentActive', { studentId: edit.student.id, active })
      setFeedback({
        text: `已${active ? '启用' : '停用'}「${edit.student.name}」。`,
        en: `${active ? 'Enabled' : 'Disabled'} the account for ${studentName(edit.student, 'en', demo)}.`,
      })
    }
    reload()
  }
  let dialogTitle = t('新建学生账号', 'New student account')
  let submitLabel = t('创建账号', 'Create account')
  if (edit?.kind === 'password') {
    dialogTitle = t('重置学生密码', 'Reset student password')
    submitLabel = t('重置密码', 'Reset password')
  } else if (edit?.kind === 'active') {
    submitLabel = edit.student.active ? t('停用账号', 'Disable account') : t('启用账号', 'Enable account')
    dialogTitle = submitLabel
  }
  return (
    <>
      <div className={s.heading}>
        <h1>{t('学生账号', 'Student accounts')}</h1>
        <Button onClick={() => open({ kind: 'create' })} leftSection={<Plus size={17} aria-hidden />} >
          {t('新建账号', 'New account')}
        </Button>
      </div>
      <Notice feedback={feedback} />
      <div className={s.toolRow}>
        <SearchBox label={t('搜索姓名或账号', 'Search names or usernames')} value={query} set={setQuery} />
        <NativeSelect
          className={s.filter}
          value={filter}
          aria-label={t('账号状态', 'Account status')}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">{t('全部状态', 'All statuses')}</option>
          <option value="active">{t('已启用', 'Active')}</option>
          <option value="inactive">{t('已停用', 'Disabled')}</option>
        </NativeSelect>
      </div>
      {error || !data ? (
        <Loading error={error} retry={reload} />
      ) : (
        <div className={s.tableBox}>
          <Table className={s.table}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('姓名', 'Name')}</Table.Th>
                <Table.Th>{t('账号', 'Username')}</Table.Th>
                <Table.Th>{t('状态', 'Status')}</Table.Th>
                <Table.Th>{t('操作', 'Actions')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.map((student) => (
                <Table.Tr key={student.id}>
                  <Table.Td>{studentName(student, lang, demo)}</Table.Td>
                  <Table.Td className={s.mono}>{student.username}</Table.Td>
                  <Table.Td>
                    <Badge tt="none" fw={500} variant="light" color={student.active ? 'pine' : 'gray'} className={student.active ? s.online : s.offline}>
                      {student.active ? t('已启用', 'Active') : t('已停用', 'Disabled')}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {student.fixedDemo ? (
                      <span className={s.subtle}>{t('示例按钮登录', 'One-click demo sign-in')}</span>
                    ) : (
                      <div className={s.cellActions}>
                        <Button variant="subtle" size="compact-sm" onClick={() => open({ kind: 'password', student })}>
                          {t('重置密码', 'Reset password')}
                        </Button>
                        <Button variant="subtle" size="compact-sm" onClick={() => open({ kind: 'active', student })}>
                          {student.active ? t('停用', 'Disable') : t('启用', 'Enable')}
                        </Button>
                      </div>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {!list.length && (
            <p className={s.empty}>
              {data.length
                ? t('没有匹配的学生账号。', 'No matching student accounts.')
                : t('还没有学生账号。', 'No student accounts yet.')}
            </p>
          )}
        </div>
      )}
      {edit && (
        <Dialog title={dialogTitle} close={() => setEdit(null)} submit={save} submitLabel={submitLabel}>
          {edit.kind === 'create' ? (
            <>
              <TextInput label={t('姓名', 'Name')} name="name" required maxLength={80} autoFocus autoComplete="off" />
                <TextInput
                  label={t('登录账号', 'Username')}
                  name="username"
                  required
                  minLength={2}
                  maxLength={80}
                  pattern="[A-Za-z0-9][A-Za-z0-9_.@\-]{1,79}"
                  title={t(
                    '2 至 80 位，以字母或数字开头，可使用字母、数字、下划线、点、@ 和短横线。',
                    'Use 2–80 characters. Start with a letter or number. Letters, numbers, underscores, periods, @ and hyphens are allowed.',
                  )}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
            </>
          ) : (
            <p className={s.dialogHelp}>
              {studentName(edit.student, lang, demo)} · {edit.student.username}
            </p>
          )}
          {edit.kind !== 'active' ? (
              <TextInput
                label={edit.kind === 'password' ? t('新密码', 'New password') : t('初始密码', 'Initial password')}
                name="password"
                type="password"
                required
                minLength={8}
                maxLength={128}
                placeholder={t('8 至 128 位字符', '8–128 characters')}
                autoComplete="new-password"
                autoFocus={edit.kind === 'password'}
              />
          ) : (
            <p className={s.dialogHelp}>
              {edit.student.active
                ? t(
                    '停用后，该学生将无法进入演示系统。',
                    'Disabling this account removes access to its demo systems.',
                  )
                : t(
                    '启用后，该学生可登录并进入已经分配的系统。',
                    'Once enabled, the student can sign in and open their assigned systems.',
                  )}
            </p>
          )}
        </Dialog>
      )}
    </>
  )
}
