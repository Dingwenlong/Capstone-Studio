import { createRoot } from 'react-dom/client'
import { Demo } from './ui/student/Demo'
import { LanguageProvider } from './ui/i18n'
import './demo-base.css'

const container = document.getElementById('demo')
if (container) {
  createRoot(container).render(
    <LanguageProvider initialLanguage={document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'}>
      <Demo systemKey={document.documentElement.dataset.system!} />
    </LanguageProvider>,
  )
}
