// The documentation site's theme: VitePress's default theme without its own
// web font, with the app's bundled fonts (Roboto Flex and Roboto Mono, from
// app/src/fonts.css) and the app's teal colours, so that nothing is fetched
// from another origin and the site looks like the app it documents.
import DefaultTheme from 'vitepress/theme-without-fonts';
import '../../../app/src/fonts.css';
import './custom.css';

export default DefaultTheme;
