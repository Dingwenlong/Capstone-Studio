export interface User {
  id: string
  username: string
  name: string
  role: 'teacher' | 'student'
  demo?: boolean
}
export interface Student extends User {
  active: boolean
  fixedDemo?: boolean
}
export interface SystemInfo {
  key: string
  name: string
  enabled: boolean
  nameEn?: string
  summary?: string
  summaryEn?: string
  repository?: string
  platforms?: string[]
  imageCount?: number
  storageBytes?: number
}
export interface Screenshot {
  id: string
  systemKey: string
  title: string
  group: string
  position: number
  width: number
  height: number
  bytes: number
}
export interface Gallery {
  system: SystemInfo
  images: Screenshot[]
}
export interface Target {
  key: string
  name: string
}
export interface Audit {
  id: string
  at: string
  actor: string
  action: string
  detail: string
}
export interface Book {
  id: string
  title: string
  location: string
  available: number
  myLoans: number
}
export interface Slot {
  id: string
  room: string
  time: string
  bookedBy: string | null
  mine: boolean
}
export interface Launch {
  url: string
  ticket: string
}
// Read action -> result (all collections are arrays, session returns User | null):
// session, systems -> SystemInfo[], students -> Student[], catalog -> SystemInfo[],
// targets -> Target[], grants({studentId}) -> string[], audit -> Audit[], books -> Book[], slots -> Slot[].
// Write actions (each receives a fresh, server-issued request ID):
// login({username,password}), demoLogin({slot:1|2}), logout({}), launch({systemKey}) -> Launch (POST ticket to url in iframe).
// createStudent({username,name,password}), setStudentActive({studentId,active}), resetPassword({studentId,password}),
// registerSystem({key,name}), setSystemEnabled({key,enabled}), setGrants({studentId,keys:string[]}),
// borrow({id}), returnBook({id}), reserve({id}), cancelReservation({id}).
export const readActions = [
  'gallery',
  'session',
  'systems',
  'students',
  'catalog',
  'targets',
  'grants',
  'audit',
  'books',
  'slots',
] as const
export const writeActions = [
  'createGallery',
  'updateGallery',
  'addScreenshot',
  'updateScreenshot',
  'moveScreenshot',
  'removeScreenshot',
  'login',
  'demoLogin',
  'logout',
  'launch',
  'createStudent',
  'setStudentActive',
  'resetPassword',
  'registerSystem',
  'setSystemEnabled',
  'setGrants',
  'borrow',
  'returnBook',
  'reserve',
  'cancelReservation',
] as const
