import Document, { Html, Head, Main, NextScript, type DocumentContext } from 'next/document'
import { languageFromCookie, type Language } from '../src/shared/i18n'
export default class ClassroomDocument extends Document<{ lang: Language }> {
  static async getInitialProps(ctx: DocumentContext) {
    return { ...(await Document.getInitialProps(ctx)), lang: languageFromCookie(ctx.req?.headers.cookie) }
  }
  render() {
    return (
      <Html lang={this.props.lang}>
        <Head />
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}
