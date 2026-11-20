import Document, { Html, Head, Main, NextScript, type DocumentContext } from 'next/document'
import { ColorSchemeScript, mantineHtmlProps } from '@mantine/core'
import { languageFromCookie, type Language } from '../src/shared/i18n'
import { studioThemeFromCookie, type StudioThemeId } from '../src/shared/studio-theme'

export default class ClassroomDocument extends Document<{ lang: Language; studioTheme: StudioThemeId }> {
  static async getInitialProps(ctx: DocumentContext) {
    const cookies = ctx.req?.headers.cookie
    return {
      ...(await Document.getInitialProps(ctx)),
      lang: languageFromCookie(cookies),
      studioTheme: studioThemeFromCookie(cookies),
    }
  }
  render() {
    return (
      <Html lang={this.props.lang} data-studio-theme={this.props.studioTheme} {...mantineHtmlProps}>
        <Head>
          <ColorSchemeScript forceColorScheme="light" />
        </Head>
        <body>
          <Main />
          <NextScript />
        </body>
      </Html>
    )
  }
}
