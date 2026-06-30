export type CountryOption = {
  code: string
  name: string
  defaultCurrency: string
  defaultTimezone: string
  timezones?: string[]
}

export type CurrencyOption = {
  code: string
  name: string
}

export type TimezoneOption = {
  value: string
  label: string
  countryCode?: string
  countryCodes?: string[]
}

export const countryOptions: CountryOption[] = [
  { code: 'AD', name: 'Andorra', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Andorra' },
  { code: 'AE', name: 'United Arab Emirates', defaultCurrency: 'AED', defaultTimezone: 'Asia/Dubai' },
  { code: 'AF', name: 'Afghanistan', defaultCurrency: 'AFN', defaultTimezone: 'Asia/Kabul' },
  { code: 'AG', name: 'Antigua and Barbuda', defaultCurrency: 'XCD', defaultTimezone: 'America/Antigua' },
  { code: 'AI', name: 'Anguilla', defaultCurrency: 'XCD', defaultTimezone: 'America/Anguilla' },
  { code: 'AL', name: 'Albania', defaultCurrency: 'ALL', defaultTimezone: 'Europe/Tirane' },
  { code: 'AM', name: 'Armenia', defaultCurrency: 'AMD', defaultTimezone: 'Asia/Yerevan' },
  { code: 'AO', name: 'Angola', defaultCurrency: 'AOA', defaultTimezone: 'Africa/Luanda' },
  { code: 'AR', name: 'Argentina', defaultCurrency: 'ARS', defaultTimezone: 'America/Argentina/Buenos_Aires', timezones: ['America/Argentina/Buenos_Aires', 'America/Argentina/Cordoba', 'America/Argentina/Mendoza'] },
  { code: 'AS', name: 'American Samoa', defaultCurrency: 'USD', defaultTimezone: 'Pacific/Pago_Pago' },
  { code: 'AT', name: 'Austria', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Vienna' },
  { code: 'AU', name: 'Australia', defaultCurrency: 'AUD', defaultTimezone: 'Australia/Adelaide', timezones: ['Australia/Adelaide', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane', 'Australia/Perth', 'Australia/Darwin', 'Australia/Hobart'] },
  { code: 'AW', name: 'Aruba', defaultCurrency: 'AWG', defaultTimezone: 'America/Aruba' },
  { code: 'AZ', name: 'Azerbaijan', defaultCurrency: 'AZN', defaultTimezone: 'Asia/Baku' },
  { code: 'BA', name: 'Bosnia and Herzegovina', defaultCurrency: 'BAM', defaultTimezone: 'Europe/Sarajevo' },
  { code: 'BB', name: 'Barbados', defaultCurrency: 'BBD', defaultTimezone: 'America/Barbados' },
  { code: 'BD', name: 'Bangladesh', defaultCurrency: 'BDT', defaultTimezone: 'Asia/Dhaka' },
  { code: 'BE', name: 'Belgium', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Brussels' },
  { code: 'BF', name: 'Burkina Faso', defaultCurrency: 'XOF', defaultTimezone: 'Africa/Ouagadougou' },
  { code: 'BG', name: 'Bulgaria', defaultCurrency: 'BGN', defaultTimezone: 'Europe/Sofia' },
  { code: 'BH', name: 'Bahrain', defaultCurrency: 'BHD', defaultTimezone: 'Asia/Bahrain' },
  { code: 'BI', name: 'Burundi', defaultCurrency: 'BIF', defaultTimezone: 'Africa/Bujumbura' },
  { code: 'BJ', name: 'Benin', defaultCurrency: 'XOF', defaultTimezone: 'Africa/Porto-Novo' },
  { code: 'BM', name: 'Bermuda', defaultCurrency: 'BMD', defaultTimezone: 'Atlantic/Bermuda' },
  { code: 'BN', name: 'Brunei', defaultCurrency: 'BND', defaultTimezone: 'Asia/Brunei' },
  { code: 'BO', name: 'Bolivia', defaultCurrency: 'BOB', defaultTimezone: 'America/La_Paz' },
  { code: 'BR', name: 'Brazil', defaultCurrency: 'BRL', defaultTimezone: 'America/Sao_Paulo', timezones: ['America/Sao_Paulo', 'America/Manaus', 'America/Fortaleza', 'America/Recife', 'America/Belem', 'America/Cuiaba', 'America/Rio_Branco'] },
  { code: 'BS', name: 'Bahamas', defaultCurrency: 'BSD', defaultTimezone: 'America/Nassau' },
  { code: 'BT', name: 'Bhutan', defaultCurrency: 'BTN', defaultTimezone: 'Asia/Thimphu' },
  { code: 'BW', name: 'Botswana', defaultCurrency: 'BWP', defaultTimezone: 'Africa/Gaborone' },
  { code: 'BY', name: 'Belarus', defaultCurrency: 'BYN', defaultTimezone: 'Europe/Minsk' },
  { code: 'BZ', name: 'Belize', defaultCurrency: 'BZD', defaultTimezone: 'America/Belize' },
  { code: 'CA', name: 'Canada', defaultCurrency: 'CAD', defaultTimezone: 'America/Toronto', timezones: ['America/Toronto', 'America/Vancouver', 'America/Edmonton', 'America/Winnipeg', 'America/Halifax', 'America/St_Johns'] },
  { code: 'CD', name: 'Democratic Republic of the Congo', defaultCurrency: 'CDF', defaultTimezone: 'Africa/Kinshasa', timezones: ['Africa/Kinshasa', 'Africa/Lubumbashi'] },
  { code: 'CF', name: 'Central African Republic', defaultCurrency: 'XAF', defaultTimezone: 'Africa/Bangui' },
  { code: 'CG', name: 'Republic of the Congo', defaultCurrency: 'XAF', defaultTimezone: 'Africa/Brazzaville' },
  { code: 'CH', name: 'Switzerland', defaultCurrency: 'CHF', defaultTimezone: 'Europe/Zurich' },
  { code: 'CI', name: "Cote d'Ivoire", defaultCurrency: 'XOF', defaultTimezone: 'Africa/Abidjan' },
  { code: 'CK', name: 'Cook Islands', defaultCurrency: 'NZD', defaultTimezone: 'Pacific/Rarotonga' },
  { code: 'CL', name: 'Chile', defaultCurrency: 'CLP', defaultTimezone: 'America/Santiago', timezones: ['America/Santiago', 'Pacific/Easter'] },
  { code: 'CM', name: 'Cameroon', defaultCurrency: 'XAF', defaultTimezone: 'Africa/Douala' },
  { code: 'CN', name: 'China', defaultCurrency: 'CNY', defaultTimezone: 'Asia/Shanghai', timezones: ['Asia/Shanghai', 'Asia/Urumqi'] },
  { code: 'CO', name: 'Colombia', defaultCurrency: 'COP', defaultTimezone: 'America/Bogota' },
  { code: 'CR', name: 'Costa Rica', defaultCurrency: 'CRC', defaultTimezone: 'America/Costa_Rica' },
  { code: 'CU', name: 'Cuba', defaultCurrency: 'CUP', defaultTimezone: 'America/Havana' },
  { code: 'CV', name: 'Cape Verde', defaultCurrency: 'CVE', defaultTimezone: 'Atlantic/Cape_Verde' },
  { code: 'CY', name: 'Cyprus', defaultCurrency: 'EUR', defaultTimezone: 'Asia/Nicosia' },
  { code: 'CZ', name: 'Czechia', defaultCurrency: 'CZK', defaultTimezone: 'Europe/Prague' },
  { code: 'DE', name: 'Germany', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Berlin', timezones: ['Europe/Berlin', 'Europe/Busingen'] },
  { code: 'DJ', name: 'Djibouti', defaultCurrency: 'DJF', defaultTimezone: 'Africa/Djibouti' },
  { code: 'DK', name: 'Denmark', defaultCurrency: 'DKK', defaultTimezone: 'Europe/Copenhagen' },
  { code: 'DM', name: 'Dominica', defaultCurrency: 'XCD', defaultTimezone: 'America/Dominica' },
  { code: 'DO', name: 'Dominican Republic', defaultCurrency: 'DOP', defaultTimezone: 'America/Santo_Domingo' },
  { code: 'DZ', name: 'Algeria', defaultCurrency: 'DZD', defaultTimezone: 'Africa/Algiers' },
  { code: 'EC', name: 'Ecuador', defaultCurrency: 'USD', defaultTimezone: 'America/Guayaquil', timezones: ['America/Guayaquil', 'Pacific/Galapagos'] },
  { code: 'EE', name: 'Estonia', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Tallinn' },
  { code: 'EG', name: 'Egypt', defaultCurrency: 'EGP', defaultTimezone: 'Africa/Cairo' },
  { code: 'ER', name: 'Eritrea', defaultCurrency: 'ERN', defaultTimezone: 'Africa/Asmara' },
  { code: 'ES', name: 'Spain', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Madrid', timezones: ['Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta'] },
  { code: 'ET', name: 'Ethiopia', defaultCurrency: 'ETB', defaultTimezone: 'Africa/Addis_Ababa' },
  { code: 'FI', name: 'Finland', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Helsinki' },
  { code: 'FJ', name: 'Fiji', defaultCurrency: 'FJD', defaultTimezone: 'Pacific/Fiji' },
  { code: 'FK', name: 'Falkland Islands', defaultCurrency: 'FKP', defaultTimezone: 'Atlantic/Stanley' },
  { code: 'FM', name: 'Micronesia', defaultCurrency: 'USD', defaultTimezone: 'Pacific/Pohnpei', timezones: ['Pacific/Pohnpei', 'Pacific/Kosrae', 'Pacific/Chuuk'] },
  { code: 'FO', name: 'Faroe Islands', defaultCurrency: 'DKK', defaultTimezone: 'Atlantic/Faroe' },
  { code: 'FR', name: 'France', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Paris' },
  { code: 'GA', name: 'Gabon', defaultCurrency: 'XAF', defaultTimezone: 'Africa/Libreville' },
  { code: 'GB', name: 'United Kingdom', defaultCurrency: 'GBP', defaultTimezone: 'Europe/London' },
  { code: 'GD', name: 'Grenada', defaultCurrency: 'XCD', defaultTimezone: 'America/Grenada' },
  { code: 'GE', name: 'Georgia', defaultCurrency: 'GEL', defaultTimezone: 'Asia/Tbilisi' },
  { code: 'GH', name: 'Ghana', defaultCurrency: 'GHS', defaultTimezone: 'Africa/Accra' },
  { code: 'GI', name: 'Gibraltar', defaultCurrency: 'GIP', defaultTimezone: 'Europe/Gibraltar' },
  { code: 'GM', name: 'Gambia', defaultCurrency: 'GMD', defaultTimezone: 'Africa/Banjul' },
  { code: 'GN', name: 'Guinea', defaultCurrency: 'GNF', defaultTimezone: 'Africa/Conakry' },
  { code: 'GQ', name: 'Equatorial Guinea', defaultCurrency: 'XAF', defaultTimezone: 'Africa/Malabo' },
  { code: 'GR', name: 'Greece', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Athens' },
  { code: 'GT', name: 'Guatemala', defaultCurrency: 'GTQ', defaultTimezone: 'America/Guatemala' },
  { code: 'GU', name: 'Guam', defaultCurrency: 'USD', defaultTimezone: 'Pacific/Guam' },
  { code: 'GW', name: 'Guinea-Bissau', defaultCurrency: 'XOF', defaultTimezone: 'Africa/Bissau' },
  { code: 'GY', name: 'Guyana', defaultCurrency: 'GYD', defaultTimezone: 'America/Guyana' },
  { code: 'HK', name: 'Hong Kong', defaultCurrency: 'HKD', defaultTimezone: 'Asia/Hong_Kong' },
  { code: 'HN', name: 'Honduras', defaultCurrency: 'HNL', defaultTimezone: 'America/Tegucigalpa' },
  { code: 'HR', name: 'Croatia', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Zagreb' },
  { code: 'HT', name: 'Haiti', defaultCurrency: 'HTG', defaultTimezone: 'America/Port-au-Prince' },
  { code: 'HU', name: 'Hungary', defaultCurrency: 'HUF', defaultTimezone: 'Europe/Budapest' },
  { code: 'ID', name: 'Indonesia', defaultCurrency: 'IDR', defaultTimezone: 'Asia/Jakarta', timezones: ['Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura'] },
  { code: 'IE', name: 'Ireland', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Dublin' },
  { code: 'IL', name: 'Israel', defaultCurrency: 'ILS', defaultTimezone: 'Asia/Jerusalem' },
  { code: 'IN', name: 'India', defaultCurrency: 'INR', defaultTimezone: 'Asia/Kolkata' },
  { code: 'IQ', name: 'Iraq', defaultCurrency: 'IQD', defaultTimezone: 'Asia/Baghdad' },
  { code: 'IR', name: 'Iran', defaultCurrency: 'IRR', defaultTimezone: 'Asia/Tehran' },
  { code: 'IS', name: 'Iceland', defaultCurrency: 'ISK', defaultTimezone: 'Atlantic/Reykjavik' },
  { code: 'IT', name: 'Italy', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Rome' },
  { code: 'JM', name: 'Jamaica', defaultCurrency: 'JMD', defaultTimezone: 'America/Jamaica' },
  { code: 'JO', name: 'Jordan', defaultCurrency: 'JOD', defaultTimezone: 'Asia/Amman' },
  { code: 'JP', name: 'Japan', defaultCurrency: 'JPY', defaultTimezone: 'Asia/Tokyo' },
  { code: 'KE', name: 'Kenya', defaultCurrency: 'KES', defaultTimezone: 'Africa/Nairobi' },
  { code: 'KG', name: 'Kyrgyzstan', defaultCurrency: 'KGS', defaultTimezone: 'Asia/Bishkek' },
  { code: 'KH', name: 'Cambodia', defaultCurrency: 'KHR', defaultTimezone: 'Asia/Phnom_Penh' },
  { code: 'KI', name: 'Kiribati', defaultCurrency: 'AUD', defaultTimezone: 'Pacific/Tarawa' },
  { code: 'KM', name: 'Comoros', defaultCurrency: 'KMF', defaultTimezone: 'Indian/Comoro' },
  { code: 'KN', name: 'Saint Kitts and Nevis', defaultCurrency: 'XCD', defaultTimezone: 'America/St_Kitts' },
  { code: 'KP', name: 'North Korea', defaultCurrency: 'KPW', defaultTimezone: 'Asia/Pyongyang' },
  { code: 'KR', name: 'South Korea', defaultCurrency: 'KRW', defaultTimezone: 'Asia/Seoul' },
  { code: 'KW', name: 'Kuwait', defaultCurrency: 'KWD', defaultTimezone: 'Asia/Kuwait' },
  { code: 'KY', name: 'Cayman Islands', defaultCurrency: 'KYD', defaultTimezone: 'America/Cayman' },
  { code: 'KZ', name: 'Kazakhstan', defaultCurrency: 'KZT', defaultTimezone: 'Asia/Almaty', timezones: ['Asia/Almaty', 'Asia/Aqtau', 'Asia/Aqtobe', 'Asia/Atyrau', 'Asia/Oral', 'Asia/Qostanay'] },
  { code: 'LA', name: 'Laos', defaultCurrency: 'LAK', defaultTimezone: 'Asia/Vientiane' },
  { code: 'LB', name: 'Lebanon', defaultCurrency: 'LBP', defaultTimezone: 'Asia/Beirut' },
  { code: 'LC', name: 'Saint Lucia', defaultCurrency: 'XCD', defaultTimezone: 'America/St_Lucia' },
  { code: 'LI', name: 'Liechtenstein', defaultCurrency: 'CHF', defaultTimezone: 'Europe/Vaduz' },
  { code: 'LK', name: 'Sri Lanka', defaultCurrency: 'LKR', defaultTimezone: 'Asia/Colombo' },
  { code: 'LR', name: 'Liberia', defaultCurrency: 'LRD', defaultTimezone: 'Africa/Monrovia' },
  { code: 'LS', name: 'Lesotho', defaultCurrency: 'LSL', defaultTimezone: 'Africa/Maseru' },
  { code: 'LT', name: 'Lithuania', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Vilnius' },
  { code: 'LU', name: 'Luxembourg', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Luxembourg' },
  { code: 'LV', name: 'Latvia', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Riga' },
  { code: 'LY', name: 'Libya', defaultCurrency: 'LYD', defaultTimezone: 'Africa/Tripoli' },
  { code: 'MA', name: 'Morocco', defaultCurrency: 'MAD', defaultTimezone: 'Africa/Casablanca' },
  { code: 'MC', name: 'Monaco', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Monaco' },
  { code: 'MD', name: 'Moldova', defaultCurrency: 'MDL', defaultTimezone: 'Europe/Chisinau' },
  { code: 'ME', name: 'Montenegro', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Podgorica' },
  { code: 'MG', name: 'Madagascar', defaultCurrency: 'MGA', defaultTimezone: 'Indian/Antananarivo' },
  { code: 'MH', name: 'Marshall Islands', defaultCurrency: 'USD', defaultTimezone: 'Pacific/Majuro' },
  { code: 'MK', name: 'North Macedonia', defaultCurrency: 'MKD', defaultTimezone: 'Europe/Skopje' },
  { code: 'ML', name: 'Mali', defaultCurrency: 'XOF', defaultTimezone: 'Africa/Bamako' },
  { code: 'MM', name: 'Myanmar', defaultCurrency: 'MMK', defaultTimezone: 'Asia/Yangon' },
  { code: 'MN', name: 'Mongolia', defaultCurrency: 'MNT', defaultTimezone: 'Asia/Ulaanbaatar', timezones: ['Asia/Ulaanbaatar', 'Asia/Hovd'] },
  { code: 'MO', name: 'Macau', defaultCurrency: 'MOP', defaultTimezone: 'Asia/Macau' },
  { code: 'MP', name: 'Northern Mariana Islands', defaultCurrency: 'USD', defaultTimezone: 'Pacific/Saipan' },
  { code: 'MR', name: 'Mauritania', defaultCurrency: 'MRU', defaultTimezone: 'Africa/Nouakchott' },
  { code: 'MT', name: 'Malta', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Malta' },
  { code: 'MU', name: 'Mauritius', defaultCurrency: 'MUR', defaultTimezone: 'Indian/Mauritius' },
  { code: 'MV', name: 'Maldives', defaultCurrency: 'MVR', defaultTimezone: 'Indian/Maldives' },
  { code: 'MW', name: 'Malawi', defaultCurrency: 'MWK', defaultTimezone: 'Africa/Blantyre' },
  { code: 'MX', name: 'Mexico', defaultCurrency: 'MXN', defaultTimezone: 'America/Mexico_City', timezones: ['America/Mexico_City', 'America/Cancun', 'America/Tijuana', 'America/Mazatlan'] },
  { code: 'MY', name: 'Malaysia', defaultCurrency: 'MYR', defaultTimezone: 'Asia/Kuala_Lumpur', timezones: ['Asia/Kuala_Lumpur', 'Asia/Kuching'] },
  { code: 'MZ', name: 'Mozambique', defaultCurrency: 'MZN', defaultTimezone: 'Africa/Maputo' },
  { code: 'NA', name: 'Namibia', defaultCurrency: 'NAD', defaultTimezone: 'Africa/Windhoek' },
  { code: 'NC', name: 'New Caledonia', defaultCurrency: 'XPF', defaultTimezone: 'Pacific/Noumea' },
  { code: 'NE', name: 'Niger', defaultCurrency: 'XOF', defaultTimezone: 'Africa/Niamey' },
  { code: 'NG', name: 'Nigeria', defaultCurrency: 'NGN', defaultTimezone: 'Africa/Lagos' },
  { code: 'NI', name: 'Nicaragua', defaultCurrency: 'NIO', defaultTimezone: 'America/Managua' },
  { code: 'NL', name: 'Netherlands', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Amsterdam' },
  { code: 'NO', name: 'Norway', defaultCurrency: 'NOK', defaultTimezone: 'Europe/Oslo' },
  { code: 'NP', name: 'Nepal', defaultCurrency: 'NPR', defaultTimezone: 'Asia/Kathmandu' },
  { code: 'NR', name: 'Nauru', defaultCurrency: 'AUD', defaultTimezone: 'Pacific/Nauru' },
  { code: 'NZ', name: 'New Zealand', defaultCurrency: 'NZD', defaultTimezone: 'Pacific/Auckland', timezones: ['Pacific/Auckland', 'Pacific/Chatham'] },
  { code: 'OM', name: 'Oman', defaultCurrency: 'OMR', defaultTimezone: 'Asia/Muscat' },
  { code: 'PA', name: 'Panama', defaultCurrency: 'PAB', defaultTimezone: 'America/Panama' },
  { code: 'PE', name: 'Peru', defaultCurrency: 'PEN', defaultTimezone: 'America/Lima' },
  { code: 'PF', name: 'French Polynesia', defaultCurrency: 'XPF', defaultTimezone: 'Pacific/Tahiti', timezones: ['Pacific/Tahiti', 'Pacific/Marquesas', 'Pacific/Gambier'] },
  { code: 'PG', name: 'Papua New Guinea', defaultCurrency: 'PGK', defaultTimezone: 'Pacific/Port_Moresby', timezones: ['Pacific/Port_Moresby', 'Pacific/Bougainville'] },
  { code: 'PH', name: 'Philippines', defaultCurrency: 'PHP', defaultTimezone: 'Asia/Manila' },
  { code: 'PK', name: 'Pakistan', defaultCurrency: 'PKR', defaultTimezone: 'Asia/Karachi' },
  { code: 'PL', name: 'Poland', defaultCurrency: 'PLN', defaultTimezone: 'Europe/Warsaw' },
  { code: 'PR', name: 'Puerto Rico', defaultCurrency: 'USD', defaultTimezone: 'America/Puerto_Rico' },
  { code: 'PS', name: 'Palestine', defaultCurrency: 'ILS', defaultTimezone: 'Asia/Gaza', timezones: ['Asia/Gaza', 'Asia/Hebron'] },
  { code: 'PT', name: 'Portugal', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Lisbon', timezones: ['Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores'] },
  { code: 'PW', name: 'Palau', defaultCurrency: 'USD', defaultTimezone: 'Pacific/Palau' },
  { code: 'PY', name: 'Paraguay', defaultCurrency: 'PYG', defaultTimezone: 'America/Asuncion' },
  { code: 'QA', name: 'Qatar', defaultCurrency: 'QAR', defaultTimezone: 'Asia/Qatar' },
  { code: 'RO', name: 'Romania', defaultCurrency: 'RON', defaultTimezone: 'Europe/Bucharest' },
  { code: 'RS', name: 'Serbia', defaultCurrency: 'RSD', defaultTimezone: 'Europe/Belgrade' },
  { code: 'RU', name: 'Russia', defaultCurrency: 'RUB', defaultTimezone: 'Europe/Moscow', timezones: ['Europe/Moscow', 'Europe/Kaliningrad', 'Asia/Yekaterinburg', 'Asia/Novosibirsk', 'Asia/Vladivostok', 'Asia/Kamchatka'] },
  { code: 'RW', name: 'Rwanda', defaultCurrency: 'RWF', defaultTimezone: 'Africa/Kigali' },
  { code: 'SA', name: 'Saudi Arabia', defaultCurrency: 'SAR', defaultTimezone: 'Asia/Riyadh' },
  { code: 'SB', name: 'Solomon Islands', defaultCurrency: 'SBD', defaultTimezone: 'Pacific/Guadalcanal' },
  { code: 'SC', name: 'Seychelles', defaultCurrency: 'SCR', defaultTimezone: 'Indian/Mahe' },
  { code: 'SD', name: 'Sudan', defaultCurrency: 'SDG', defaultTimezone: 'Africa/Khartoum' },
  { code: 'SE', name: 'Sweden', defaultCurrency: 'SEK', defaultTimezone: 'Europe/Stockholm' },
  { code: 'SG', name: 'Singapore', defaultCurrency: 'SGD', defaultTimezone: 'Asia/Singapore' },
  { code: 'SI', name: 'Slovenia', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Ljubljana' },
  { code: 'SK', name: 'Slovakia', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Bratislava' },
  { code: 'SL', name: 'Sierra Leone', defaultCurrency: 'SLL', defaultTimezone: 'Africa/Freetown' },
  { code: 'SM', name: 'San Marino', defaultCurrency: 'EUR', defaultTimezone: 'Europe/San_Marino' },
  { code: 'SN', name: 'Senegal', defaultCurrency: 'XOF', defaultTimezone: 'Africa/Dakar' },
  { code: 'SO', name: 'Somalia', defaultCurrency: 'SOS', defaultTimezone: 'Africa/Mogadishu' },
  { code: 'SR', name: 'Suriname', defaultCurrency: 'SRD', defaultTimezone: 'America/Paramaribo' },
  { code: 'SS', name: 'South Sudan', defaultCurrency: 'SSP', defaultTimezone: 'Africa/Juba' },
  { code: 'ST', name: 'Sao Tome and Principe', defaultCurrency: 'STN', defaultTimezone: 'Africa/Sao_Tome' },
  { code: 'SV', name: 'El Salvador', defaultCurrency: 'USD', defaultTimezone: 'America/El_Salvador' },
  { code: 'SY', name: 'Syria', defaultCurrency: 'SYP', defaultTimezone: 'Asia/Damascus' },
  { code: 'SZ', name: 'Eswatini', defaultCurrency: 'SZL', defaultTimezone: 'Africa/Mbabane' },
  { code: 'TC', name: 'Turks and Caicos Islands', defaultCurrency: 'USD', defaultTimezone: 'America/Grand_Turk' },
  { code: 'TD', name: 'Chad', defaultCurrency: 'XAF', defaultTimezone: 'Africa/Ndjamena' },
  { code: 'TG', name: 'Togo', defaultCurrency: 'XOF', defaultTimezone: 'Africa/Lome' },
  { code: 'TH', name: 'Thailand', defaultCurrency: 'THB', defaultTimezone: 'Asia/Bangkok' },
  { code: 'TJ', name: 'Tajikistan', defaultCurrency: 'TJS', defaultTimezone: 'Asia/Dushanbe' },
  { code: 'TL', name: 'Timor-Leste', defaultCurrency: 'USD', defaultTimezone: 'Asia/Dili' },
  { code: 'TM', name: 'Turkmenistan', defaultCurrency: 'TMT', defaultTimezone: 'Asia/Ashgabat' },
  { code: 'TN', name: 'Tunisia', defaultCurrency: 'TND', defaultTimezone: 'Africa/Tunis' },
  { code: 'TO', name: 'Tonga', defaultCurrency: 'TOP', defaultTimezone: 'Pacific/Tongatapu' },
  { code: 'TR', name: 'Turkey', defaultCurrency: 'TRY', defaultTimezone: 'Europe/Istanbul' },
  { code: 'TT', name: 'Trinidad and Tobago', defaultCurrency: 'TTD', defaultTimezone: 'America/Port_of_Spain' },
  { code: 'TV', name: 'Tuvalu', defaultCurrency: 'AUD', defaultTimezone: 'Pacific/Funafuti' },
  { code: 'TW', name: 'Taiwan', defaultCurrency: 'TWD', defaultTimezone: 'Asia/Taipei' },
  { code: 'TZ', name: 'Tanzania', defaultCurrency: 'TZS', defaultTimezone: 'Africa/Dar_es_Salaam' },
  { code: 'UA', name: 'Ukraine', defaultCurrency: 'UAH', defaultTimezone: 'Europe/Kyiv' },
  { code: 'UG', name: 'Uganda', defaultCurrency: 'UGX', defaultTimezone: 'Africa/Kampala' },
  { code: 'US', name: 'United States', defaultCurrency: 'USD', defaultTimezone: 'America/New_York', timezones: ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu'] },
  { code: 'UY', name: 'Uruguay', defaultCurrency: 'UYU', defaultTimezone: 'America/Montevideo' },
  { code: 'UZ', name: 'Uzbekistan', defaultCurrency: 'UZS', defaultTimezone: 'Asia/Tashkent', timezones: ['Asia/Tashkent', 'Asia/Samarkand'] },
  { code: 'VA', name: 'Vatican City', defaultCurrency: 'EUR', defaultTimezone: 'Europe/Vatican' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', defaultCurrency: 'XCD', defaultTimezone: 'America/St_Vincent' },
  { code: 'VE', name: 'Venezuela', defaultCurrency: 'VES', defaultTimezone: 'America/Caracas' },
  { code: 'VG', name: 'British Virgin Islands', defaultCurrency: 'USD', defaultTimezone: 'America/Tortola' },
  { code: 'VI', name: 'U.S. Virgin Islands', defaultCurrency: 'USD', defaultTimezone: 'America/St_Thomas' },
  { code: 'VN', name: 'Vietnam', defaultCurrency: 'VND', defaultTimezone: 'Asia/Ho_Chi_Minh' },
  { code: 'VU', name: 'Vanuatu', defaultCurrency: 'VUV', defaultTimezone: 'Pacific/Efate' },
  { code: 'WS', name: 'Samoa', defaultCurrency: 'WST', defaultTimezone: 'Pacific/Apia' },
  { code: 'YE', name: 'Yemen', defaultCurrency: 'YER', defaultTimezone: 'Asia/Aden' },
  { code: 'ZA', name: 'South Africa', defaultCurrency: 'ZAR', defaultTimezone: 'Africa/Johannesburg' },
  { code: 'ZM', name: 'Zambia', defaultCurrency: 'ZMW', defaultTimezone: 'Africa/Lusaka' },
  { code: 'ZW', name: 'Zimbabwe', defaultCurrency: 'ZWL', defaultTimezone: 'Africa/Harare' },
]

const currencyDisplayNames =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'currency' })
    : null

export const currencyOptions: CurrencyOption[] = Array.from(
  new Set(countryOptions.map((country) => country.defaultCurrency)),
)
  .sort((left, right) => left.localeCompare(right))
  .map((code) => ({
    code,
    name: currencyDisplayNames?.of(code) ?? code,
  }))

const countryCodesByTimezone = new Map<string, string[]>()

for (const country of countryOptions) {
  for (const timezone of country.timezones ?? [country.defaultTimezone]) {
    countryCodesByTimezone.set(timezone, [
      ...(countryCodesByTimezone.get(timezone) ?? []),
      country.code,
    ])
  }
}

const fallbackTimezoneOptions: TimezoneOption[] = [
  ...Array.from(countryCodesByTimezone.entries()).map(([value, countryCodes]) => ({
    value,
    label: value,
    countryCode: countryCodes[0],
    countryCodes,
  })),
  { value: 'UTC', label: 'UTC' },
]

export function getCountryOption(countryCode: string | null | undefined) {
  return countryOptions.find((country) => country.code === normalizeCountryCode(countryCode))
}

export function getCountryDefaults(countryCode: string | null | undefined) {
  return getCountryOption(countryCode) ?? countryOptions.find((country) => country.code === 'AU') ?? countryOptions[0]
}

export function normalizeCountryCode(countryCode: string | null | undefined) {
  return (countryCode || 'AU').trim().toUpperCase()
}

export function inferCountryCode(currency: string | null | undefined, timezone: string | null | undefined) {
  const normalizedCurrency = currency?.trim().toUpperCase()
  const normalizedTimezone = timezone?.trim()

  return countryOptions.find(
    (country) =>
      country.defaultCurrency === normalizedCurrency ||
      country.defaultTimezone === normalizedTimezone ||
      country.timezones?.includes(normalizedTimezone ?? ''),
  )?.code ?? 'AU'
}

export function timezoneBelongsToCountry(timezone: TimezoneOption, countryCode: string) {
  const normalizedCountryCode = normalizeCountryCode(countryCode)
  return timezone.countryCode === normalizedCountryCode || timezone.countryCodes?.includes(normalizedCountryCode) === true
}

export function getTimezoneOptions(): TimezoneOption[] {
  const supportedValuesOf = Intl.supportedValuesOf?.bind(Intl)
  const browserTimezones = supportedValuesOf?.('timeZone')

  if (!browserTimezones?.length) {
    return fallbackTimezoneOptions
  }

  return browserTimezones.map((timezone) => {
    const countryCodes = countryCodesByTimezone.get(timezone)

    return {
      value: timezone,
      label: timezone,
      countryCode: countryCodes?.[0],
      countryCodes,
    }
  })
}
