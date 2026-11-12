import { requestStop } from '../src/server/local-control'
try {
  await requestStop()
  console.log('已请求服务正常关闭。')
} catch {
  console.error('未找到可关闭的本机服务。')
  process.exitCode = 1
}
