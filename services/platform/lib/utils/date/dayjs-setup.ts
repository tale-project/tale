import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import relativeTime from 'dayjs/plugin/relativeTime';
import isToday from 'dayjs/plugin/isToday';
import isYesterday from 'dayjs/plugin/isYesterday';
import localizedFormat from 'dayjs/plugin/localizedFormat';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore';
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter';

// Import locales — base + regional variants
import 'dayjs/locale/en';
import 'dayjs/locale/en-au';
import 'dayjs/locale/en-ca';
import 'dayjs/locale/en-gb';
import 'dayjs/locale/en-ie';
import 'dayjs/locale/en-in';
import 'dayjs/locale/en-nz';
import 'dayjs/locale/en-sg';
import 'dayjs/locale/de';
import 'dayjs/locale/de-at';
import 'dayjs/locale/de-ch';
import 'dayjs/locale/fr';
import 'dayjs/locale/fr-ca';
import 'dayjs/locale/fr-ch';
import 'dayjs/locale/zh';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/zh-hk';
import 'dayjs/locale/zh-tw';
import 'dayjs/locale/nl';
import 'dayjs/locale/nl-be';
import 'dayjs/locale/es';
import 'dayjs/locale/it';
import 'dayjs/locale/it-ch';
import 'dayjs/locale/pt';
import 'dayjs/locale/pt-br';
import 'dayjs/locale/ja';
import 'dayjs/locale/ko';
import 'dayjs/locale/sv';
import 'dayjs/locale/da';
import 'dayjs/locale/fi';
import 'dayjs/locale/nb';
import 'dayjs/locale/pl';
import 'dayjs/locale/ru';
import 'dayjs/locale/tr';
import 'dayjs/locale/ar';

// Extend dayjs with plugins
dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);
dayjs.extend(isToday);
dayjs.extend(isYesterday);
dayjs.extend(localizedFormat);
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);
dayjs.extend(isSameOrAfter);

// Set default locale to English
dayjs.locale('en');

export default dayjs;
