export type Language = 'zh-CN' | 'en'
export const defaultLanguage: Language = 'en'
export const languageCookie = 'classroom_language'

export function languageFromCookie(cookies: string | undefined): Language {
  const value = cookies
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(languageCookie + '='))
  return value === languageCookie + '=zh-CN' ? 'zh-CN' : defaultLanguage
}

const labels: Record<string, string> = {
  图书借阅: 'Library',
  实验室预约: 'Lab reservations',
  '学生 A': 'Student A',
  '学生 B': 'Student B',
  演示教师: 'Demo teacher',
  '示例学生 A': 'Demo student A',
  '示例学生 B': 'Demo student B',
  '示例教师 A': 'Demo teacher A',
  '示例教师 B': 'Demo teacher B',
  软件工程导论: 'Introduction to Software Engineering',
  数据库系统概论: 'Database Systems',
  交互设计精髓: 'Interaction Design Essentials',
  数据可视化实践: 'Practical Data Visualization',
  人机交互基础: 'Fundamentals of Human–Computer Interaction',
  计算机网络: 'Computer Networks',
  软件工程实验室: 'Software Engineering Lab',
  网络实验室: 'Networking Lab',
  交互设计实验室: 'Interaction Design Lab',
  已预约: 'Reserved',
}
export function displayLabel(text: string, lang: Language): string {
  if (lang === 'zh-CN') return text
  if (Object.hasOwn(labels, text)) return labels[text]
  const shelf = /^(计算机|设计) · ([AB]-\d{2})$/.exec(text)
  if (shelf) return (shelf[1] === '计算机' ? 'Computing' : 'Design') + ' · ' + shelf[2]
  const slot = /^周([一二三四五六日]) (\d\d:\d\d–\d\d:\d\d)$/.exec(text)
  if (slot)
    return (
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']['一二三四五六日'.indexOf(slot[1])] + ' ' + slot[2]
    )
  return text
}

const errors: Record<string, string> = {
  '内置示例学生使用按钮登录。可对新建的演示学生停用或重置密码。':
    'Built-in demo students sign in with a button. You can disable or reset passwords for students you create in the demo.',
  '请从学生或教师登录页使用示例账号。': 'Use a demo account from the student or teacher sign-in page.',
  '请选择有效的示例账号。': 'Choose a valid demo account.',
  '系统暂时无法访问，请刷新授权后重试。': 'This system is unavailable. Refresh your access and try again.',
  '系统响应超时，请稍后重试。': 'The system took too long to respond. Try again in a moment.',
  '示例账号暂时不可用。': 'This demo account is temporarily unavailable.',
  '找不到此入口。': 'This site could not be found.',
  '找不到此页面。': 'Page not found.',
  '请从学生工作台打开系统。': 'Open this system from your student workspace.',
  '你的账号当前无权访问该系统。请返回工作台查看授权。':
    'You do not have access to this system. Return to your workspace to see your systems.',
  '该演示系统暂时离线。请稍后重新打开此页签。': 'This system is offline. Reopen its tab in a moment.',
  '该演示系统暂时离线。其他系统仍可使用，请稍后重新打开此页签。':
    'This system is offline. You can use the other systems and reopen this tab later.',
  '服务暂时不可用，请稍后再试。': 'The service is unavailable. Try again in a moment.',
  '服务暂时不可用，请稍后刷新。': 'The service is unavailable. Refresh the page in a moment.',
  '该操作不可用。': 'This operation is unavailable.',
  '请求来源不符。': 'This request came from an unexpected site.',
  '请求来源不符，请刷新页面。': 'This request came from an unexpected site. Refresh the page.',
  '请求内容过大。': 'The request is too large.',
  '系统返回的跳转地址不在接入范围内。': 'This system tried to redirect outside its registered site.',
  '请刷新页面后重新登录。': 'Refresh the page and sign in again.',
  '未知操作。': 'Unknown operation.',
  '请从该账号的登录页面进入。': 'Use the sign-in page for this account.',
  '账号或密码错误。': 'Incorrect username or password.',
  '尝试次数过多，请稍后再试。': 'Too many attempts. Try again later.',
  '缺少有效的请求标识。': 'A valid request ID is required.',
  '缺少有效的请求编号，请重新操作。': 'A valid request ID is required. Try the action again.',
  '请求标识已使用、已过期或与本次操作不符。':
    'This request ID has been used, has expired, or belongs to a different action.',
  '此系统当前不可访问。': 'This system is currently unavailable.',
  '启动凭据无效。': 'This launch ticket is invalid.',
  '启动凭据已失效，请从工作台重新打开。':
    'This launch ticket has expired. Reopen the system from your workspace.',
  '启动凭据已使用。': 'This launch ticket has already been used.',
  '请求内容无效。': 'Invalid request.',
  '请检查输入的文字。': 'Check the text you entered.',
  '账号应为 2 至 80 个英文、数字或常用账号符号。':
    'Use 2–80 letters, numbers, or supported username symbols.',
  '密码长度需在 8 到 128 个字符之间。': 'Use a password between 8 and 128 characters.',
  '状态值无效。': 'Invalid status.',
  '登录已失效或缺少该系统的访问权限。':
    'Your session has expired or you no longer have access to this system.',
  '此账号当前无权访问该系统。': 'This account does not have access to this system.',
  '找不到该学生账号。': 'Student account not found.',
  '此账号无权执行该操作。': 'This account does not have permission to do that.',
  '未知查询。': 'Unknown query.',
  '该账号已存在。': 'This username is already in use.',
  '请选择部署清单内的系统。': 'Choose a system from the deployment list.',
  '该系统已登记。': 'This system is already registered.',
  '找不到该系统。': 'System not found.',
  '系统清单无效。': 'Invalid system list.',
  '授权包含未登记的系统。': 'The selection contains an unregistered system.',
  '教师端不支持此操作。': 'This action is unavailable in teacher administration.',
  '找不到该书。': 'Book not found.',
  '该书已无可借库存。': 'There are no copies available to borrow.',
  '你没有这本书的待还记录。': 'You have no outstanding loan for this book.',
  '找不到该时段。': 'Time slot not found.',
  '该时段已被预约。': 'This time slot is already reserved.',
  '你没有此时段的预约。': 'You do not have a reservation for this time slot.',
  '此系统无权执行该操作。': 'This system cannot perform this action.',
  '连接中断，请检查网络后刷新。': 'Connection lost. Check your network and refresh the page.',
  '未收到提交结果。请核对当前记录后再操作。':
    'No confirmation was received. Check the current records before trying again.',
}
const reverseErrors = new Map(Object.entries(errors).map(([zh, en]) => [en, zh]))
export function localizeMessage(text: string, lang: Language): string {
  return lang === 'en'
    ? Object.hasOwn(errors, text)
      ? errors[text]
      : text
    : (reverseErrors.get(text) ?? text)
}
