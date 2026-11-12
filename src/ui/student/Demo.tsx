'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Book, Slot } from '../../shared/contract'
import { displayLabel, localizeMessage } from '../../shared/i18n'
import { useLanguage } from '../i18n'
import { read, write } from '../client'
import { errorText, Icon } from './Chrome'
import s from './student.module.css'

type DemoData = { books: Book[]; slots: Slot[] }
type Action = 'borrow' | 'returnBook' | 'reserve' | 'cancelReservation'

export function Demo({ systemKey }: { systemKey: string }) {
  const { t, lang } = useLanguage()
  const library = systemKey === 'library'
  const validSystem = library || systemKey === 'lab'
  useEffect(() => {
    if (validSystem) document.title = displayLabel(library ? '图书借阅' : '实验室预约', lang)
  }, [lang, library, validSystem])
  const [data, setData] = useState<DemoData>({ books: [], slots: [] })
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ action: Action; item: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [reservationFilter, setReservationFilter] = useState('all')
  const activeWrite = useRef(false)
  const readSeq = useRef(0)

  const refresh = useCallback(async () => {
    if (!validSystem) return
    const seq = ++readSeq.current
    try {
      const next: DemoData = library
        ? { books: await read<Book[]>('books'), slots: [] }
        : { books: [], slots: await read<Slot[]>('slots') }
      if (seq !== readSeq.current) return
      setData(next)
      setError('')
      setReady(true)
    } catch (reason) {
      if (seq !== readSeq.current) return
      setData({ books: [], slots: [] })
      setReady(false)
      setError(errorText(reason))
    }
  }, [library, validSystem])

  useEffect(() => {
    void refresh()
    const wake = () => {
      if (!document.hidden && !activeWrite.current) void refresh()
    }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    const timer = window.setInterval(wake, 20000)
    return () => {
      ++readSeq.current
      window.clearInterval(timer)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [refresh])

  async function apply(action: Action, id: string, item: string) {
    if (activeWrite.current) return
    activeWrite.current = true
    setBusy(true)
    setError('')
    setNotice(null)
    try {
      await write(action, { id })
      setNotice({ action, item })
      await refresh()
    } catch (reason) {
      await refresh()
      setError(errorText(reason))
    } finally {
      activeWrite.current = false
      setBusy(false)
    }
  }

  function searchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setQuery(search.trim().toLowerCase())
  }
  const label = (value: string) => displayLabel(value, lang)
  const successfulItem = notice ? label(notice.item) : ''
  const confirmations: Record<Action, string> = {
    borrow: t('已借阅《' + successfulItem + '》。', 'Borrowed “' + successfulItem + '”.'),
    returnBook: t('已归还一本《' + successfulItem + '》。', 'Returned one copy of “' + successfulItem + '”.'),
    reserve: t('已预约' + successfulItem + '。', 'Reserved ' + successfulItem + '.'),
    cancelReservation: t('已取消本次预约。', 'Reservation canceled.'),
  }
  const searchLabel = library ? t('搜索书名', 'Search book titles') : t('搜索实验室或时段', 'Search labs or times')
  const books = data.books.filter((book) =>
    (book.title + ' ' + displayLabel(book.title, 'en')).toLowerCase().includes(query))
  const loans = data.books.filter((book) => book.myLoans > 0)
  const slots = data.slots.filter((slot) => {
    const matchesText = [slot.room, slot.time, displayLabel(slot.room, 'en'), displayLabel(slot.time, 'en')]
      .join(' ').toLowerCase().includes(query)
    return (
      matchesText &&
      (reservationFilter === 'all' || (reservationFilter === 'mine' ? slot.mine : !slot.bookedBy))
    )
  })
  if (!validSystem)
    return (
      <main className={s.demo}>
        <h1>{t('系统暂不可用', 'System unavailable')}</h1>
      </main>
    )
  return (
    <main className={s.demo}>
      <h1>{label(library ? '图书借阅' : '实验室预约')}</h1>
      {!ready ? (
        <div aria-live="polite">
          {error ? (
            <>
              <p className={s.failure}>{localizeMessage(error, lang)}</p>
              <button className={s.darkButton} onClick={refresh}>
                {t('重新加载', 'Reload')}
              </button>
            </>
          ) : (
            t('正在读取数据…', 'Loading data…')
          )}
        </div>
      ) : (
        <>
          <form className={s.tools} onSubmit={searchSubmit}>
            <label className={s.searchField}>
              <Icon name="search" />
              <input
                type="search"
                aria-label={searchLabel}
                placeholder={searchLabel}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  if (!event.target.value) setQuery('')
                }}
              />
            </label>
            <button className={s.darkButton}>{t('搜索', 'Search')}</button>
            {!library && (
              <select
                aria-label={t('预约状态', 'Reservation status')}
                value={reservationFilter}
                onChange={(event) => setReservationFilter(event.target.value)}
              >
                <option value="all">{t('全部时段', 'All time slots')}</option>
                <option value="available">{t('可预约', 'Available')}</option>
                <option value="mine">{t('我的预约', 'My reservations')}</option>
              </select>
            )}
          </form>
          {error && (
            <p className={s.failure} role="alert">
              {localizeMessage(error, lang)}
            </p>
          )}
          {notice && (
            <p role="status" className={s.notice}>
              {confirmations[notice.action]}
            </p>
          )}
          <div className={s.tableWrap}>
            <table className={s.table} aria-label={library ? t('馆藏图书', 'Library catalog') : t('实验室时段', 'Lab time slots')}>
              {library ? (
                <>
                  <thead>
                    <tr>
                      <th scope="col">{t('书名', 'Title')}</th>
                      <th scope="col">{t('馆藏位置', 'Location')}</th>
                      <th scope="col">{t('可借数量', 'Available copies')}</th>
                      <th scope="col">{t('操作', 'Action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {books.map((book) => (
                      <tr key={book.id}>
                        <td>{label(book.title)}</td>
                        <td>{label(book.location)}</td>
                        <td>{book.available}</td>
                        <td>
                          <button
                            className={s.darkButton}
                            disabled={busy || book.available === 0}
                            onClick={() => apply('borrow', book.id, book.title)}
                          >
                            {book.available > 0 ? t('借阅', 'Borrow') : t('已借完', 'All on loan')}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!books.length && (
                      <tr>
                        <td colSpan={4} className={s.emptyRow}>
                          {t('没有找到匹配的图书。', 'No books match your search.')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </>
              ) : (
                <>
                  <thead>
                    <tr>
                      <th scope="col">{t('实验室', 'Lab')}</th>
                      <th scope="col">{t('时段', 'Time slot')}</th>
                      <th scope="col">{t('状态', 'Status')}</th>
                      <th scope="col">{t('操作', 'Action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slots.map((slot) => (
                      <tr key={slot.id}>
                        <td>{label(slot.room)}</td>
                        <td>{label(slot.time)}</td>
                        <td>{slot.mine ? t('我的预约', 'Reserved by you') : slot.bookedBy ? t('已约满', 'Booked') : t('可预约', 'Available')}</td>
                        <td>
                          <button
                            className={s.darkButton}
                            disabled={busy || (!!slot.bookedBy && !slot.mine)}
                            onClick={() =>
                              apply(
                                slot.mine ? 'cancelReservation' : 'reserve',
                                slot.id,
                                slot.room,
                              )
                            }
                          >
                            {slot.mine ? t('取消预约', 'Cancel') : slot.bookedBy ? t('已约满', 'Booked') : t('预约', 'Reserve')}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!slots.length && (
                      <tr>
                        <td colSpan={4} className={s.emptyRow}>
                          {t('没有符合条件的时段。', 'No time slots match your selection.')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </>
              )}
            </table>
          </div>
          {library && loans.length > 0 && (
            <>
              <h2 className={s.subheading}>{t('我的借阅', 'My loans')}</h2>
              <div className={s.tableWrap}>
                <table className={s.table} aria-label={t('我的借阅', 'My loans')}>
                  <thead>
                    <tr>
                      <th scope="col">{t('书名', 'Title')}</th>
                      <th scope="col">{t('待还数量', 'Copies on loan')}</th>
                      <th scope="col">{t('操作', 'Action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loans.map((book) => (
                      <tr key={book.id}>
                        <td>{label(book.title)}</td>
                        <td>{book.myLoans}</td>
                        <td>
                          <button
                            className={s.darkButton}
                            disabled={busy}
                            onClick={() => apply('returnBook', book.id, book.title)}
                          >
                            {t('归还', 'Return')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </main>
  )
}
