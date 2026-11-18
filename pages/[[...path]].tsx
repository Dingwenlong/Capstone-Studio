import Head from 'next/head'
import type { GetServerSideProps } from 'next'
import Login from '../src/ui/Login'
import { Landing, Workspace } from '../src/ui/student'
import Admin from '../src/ui/teacher'
import { languageFromCookie, type Language } from '../src/shared/i18n'
import { useLanguage } from '../src/ui/i18n'
import { hostKey } from '../src/server/hosts'

type Props = { host: string; path: string; lang: Language }
export const getServerSideProps: GetServerSideProps<Props> = async ({ req, resolvedUrl }) => {
  const host = hostKey(req.headers.host)
  if (host !== 'portal' && host !== 'admin') return { notFound: true }
  return {
    props: { host, path: resolvedUrl.split('?')[0], lang: languageFromCookie(req.headers.cookie) },
  }
}
export default function Screen({ host, path }: Props) {
  const {t} = useLanguage()
  const title = host === 'admin' ? t('教学管理','Teacher admin') : t('程序研习录','Capstone Demo Studio')
  let body
  if (path === '/login') body = <Login teacher={host === 'admin'} />
  else if (host === 'admin') body = <Admin section={path.split('/')[2] || 'students'} />
  else body = path === '/workspace' ? <Workspace /> : <Landing />
  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      {body}
    </>
  )
}
