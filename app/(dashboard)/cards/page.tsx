'use client';

import { useEffect, useRef, useState } from 'react';

const ISO_COUNTRIES = [
  { code: 'AF', name: 'Afghanistan', symbol: '؋', currency: 'AFN' },
  { code: 'AL', name: 'Albania', symbol: 'L', currency: 'ALL' },
  { code: 'DZ', name: 'Algeria', symbol: 'DA', currency: 'DZD' },
  { code: 'AS', name: 'American Samoa', symbol: '$', currency: 'USD' },
  { code: 'AD', name: 'Andorra', symbol: '€', currency: 'EUR' },
  { code: 'AO', name: 'Angola', symbol: 'Kz', currency: 'AOA' },
  { code: 'AI', name: 'Anguilla', symbol: 'EC$', currency: 'XCD' },
  { code: 'AG', name: 'Antigua and Barbuda', symbol: 'EC$', currency: 'XCD' },
  { code: 'AR', name: 'Argentina', symbol: '$', currency: 'ARS' },
  { code: 'AM', name: 'Armenia', symbol: '֏', currency: 'AMD' },
  { code: 'AW', name: 'Aruba', symbol: 'ƒ', currency: 'AWG' },
  { code: 'AU', name: 'Australia', symbol: 'A$', currency: 'AUD' },
  { code: 'AT', name: 'Austria', symbol: '€', currency: 'EUR' },
  { code: 'AZ', name: 'Azerbaijan', symbol: '₼', currency: 'AZN' },
  { code: 'BS', name: 'Bahamas', symbol: 'B$', currency: 'BSD' },
  { code: 'BH', name: 'Bahrain', symbol: 'BD', currency: 'BHD' },
  { code: 'BD', name: 'Bangladesh', symbol: '৳', currency: 'BDT' },
  { code: 'BB', name: 'Barbados', symbol: 'Bds$', currency: 'BBD' },
  { code: 'BY', name: 'Belarus', symbol: 'Br', currency: 'BYN' },
  { code: 'BE', name: 'Belgium', symbol: '€', currency: 'EUR' },
  { code: 'BZ', name: 'Belize', symbol: 'BZ$', currency: 'BZD' },
  { code: 'BJ', name: 'Benin', symbol: 'CFA', currency: 'XOF' },
  { code: 'BM', name: 'Bermuda', symbol: 'BD$', currency: 'BMD' },
  { code: 'BT', name: 'Bhutan', symbol: 'Nu', currency: 'BTN' },
  { code: 'BO', name: 'Bolivia', symbol: 'Bs', currency: 'BOB' },
  { code: 'BA', name: 'Bosnia and Herzegovina', symbol: 'KM', currency: 'BAM' },
  { code: 'BW', name: 'Botswana', symbol: 'P', currency: 'BWP' },
  { code: 'BR', name: 'Brazil', symbol: 'R$', currency: 'BRL' },
  { code: 'BN', name: 'Brunei', symbol: 'B$', currency: 'BND' },
  { code: 'BG', name: 'Bulgaria', symbol: 'лв', currency: 'BGN' },
  { code: 'BF', name: 'Burkina Faso', symbol: 'CFA', currency: 'XOF' },
  { code: 'BI', name: 'Burundi', symbol: 'FBu', currency: 'BIF' },
  { code: 'KH', name: 'Cambodia', symbol: '៛', currency: 'KHR' },
  { code: 'CM', name: 'Cameroon', symbol: 'FCF', currency: 'XAF' },
  { code: 'CA', name: 'Canada', symbol: 'C$', currency: 'CAD' },
  { code: 'CV', name: 'Cape Verde', symbol: 'Esc', currency: 'CVE' },
  { code: 'KY', name: 'Cayman Islands', symbol: 'CI$', currency: 'KYD' },
  { code: 'CF', name: 'Central African Republic', symbol: 'FCF', currency: 'XAF' },
  { code: 'TD', name: 'Chad', symbol: 'FCF', currency: 'XAF' },
  { code: 'CL', name: 'Chile', symbol: '$', currency: 'CLP' },
  { code: 'CN', name: 'China', symbol: '¥', currency: 'CNY' },
  { code: 'CO', name: 'Colombia', symbol: '$', currency: 'COP' },
  { code: 'KM', name: 'Comoros', symbol: 'CF', currency: 'KMF' },
  { code: 'CG', name: 'Congo', symbol: 'FCF', currency: 'XAF' },
  { code: 'CD', name: 'Congo (DRC)', symbol: 'FC', currency: 'CDF' },
  { code: 'CR', name: 'Costa Rica', symbol: '₡', currency: 'CRC' },
  { code: 'CI', name: 'Côte d\u2019Ivoire', symbol: 'CFA', currency: 'XOF' },
  { code: 'HR', name: 'Croatia', symbol: '€', currency: 'EUR' },
  { code: 'CU', name: 'Cuba', symbol: '$', currency: 'CUP' },
  { code: 'CY', name: 'Cyprus', symbol: '€', currency: 'EUR' },
  { code: 'CZ', name: 'Czech Republic', symbol: 'Kč', currency: 'CZK' },
  { code: 'DK', name: 'Denmark', symbol: 'kr', currency: 'DKK' },
  { code: 'DJ', name: 'Djibouti', symbol: 'Fdj', currency: 'DJF' },
  { code: 'DM', name: 'Dominica', symbol: 'EC$', currency: 'XCD' },
  { code: 'DO', name: 'Dominican Republic', symbol: 'RD$', currency: 'DOP' },
  { code: 'EC', name: 'Ecuador', symbol: '$', currency: 'USD' },
  { code: 'EG', name: 'Egypt', symbol: 'E£', currency: 'EGP' },
  { code: 'SV', name: 'El Salvador', symbol: '$', currency: 'USD' },
  { code: 'GQ', name: 'Equatorial Guinea', symbol: 'FCF', currency: 'XAF' },
  { code: 'ER', name: 'Eritrea', symbol: 'Nfk', currency: 'ERN' },
  { code: 'EE', name: 'Estonia', symbol: '€', currency: 'EUR' },
  { code: 'SZ', name: 'Eswatini', symbol: 'E', currency: 'SZL' },
  { code: 'ET', name: 'Ethiopia', symbol: 'Br', currency: 'ETB' },
  { code: 'FJ', name: 'Fiji', symbol: 'FJ$', currency: 'FJD' },
  { code: 'FI', name: 'Finland', symbol: '€', currency: 'EUR' },
  { code: 'FR', name: 'France', symbol: '€', currency: 'EUR' },
  { code: 'GF', name: 'French Guiana', symbol: '€', currency: 'EUR' },
  { code: 'PF', name: 'French Polynesia', symbol: 'F', currency: 'XPF' },
  { code: 'GA', name: 'Gabon', symbol: 'FCF', currency: 'XAF' },
  { code: 'GM', name: 'Gambia', symbol: 'D', currency: 'GMD' },
  { code: 'GE', name: 'Georgia', symbol: '₾', currency: 'GEL' },
  { code: 'DE', name: 'Germany', symbol: '€', currency: 'EUR' },
  { code: 'GH', name: 'Ghana', symbol: '₵', currency: 'GHS' },
  { code: 'GI', name: 'Gibraltar', symbol: '£', currency: 'GIP' },
  { code: 'GR', name: 'Greece', symbol: '€', currency: 'EUR' },
  { code: 'GL', name: 'Greenland', symbol: 'kr', currency: 'DKK' },
  { code: 'GD', name: 'Grenada', symbol: 'EC$', currency: 'XCD' },
  { code: 'GP', name: 'Guadeloupe', symbol: '€', currency: 'EUR' },
  { code: 'GU', name: 'Guam', symbol: '$', currency: 'USD' },
  { code: 'GT', name: 'Guatemala', symbol: 'Q', currency: 'GTQ' },
  { code: 'GN', name: 'Guinea', symbol: 'FG', currency: 'GNF' },
  { code: 'GW', name: 'Guinea-Bissau', symbol: 'CFA', currency: 'XOF' },
  { code: 'GY', name: 'Guyana', symbol: 'G$', currency: 'GYD' },
  { code: 'HT', name: 'Haiti', symbol: 'G', currency: 'HTG' },
  { code: 'HN', name: 'Honduras', symbol: 'L', currency: 'HNL' },
  { code: 'HK', name: 'Hong Kong', symbol: 'HK$', currency: 'HKD' },
  { code: 'HU', name: 'Hungary', symbol: 'Ft', currency: 'HUF' },
  { code: 'IS', name: 'Iceland', symbol: 'kr', currency: 'ISK' },
  { code: 'IN', name: 'India', symbol: '₹', currency: 'INR' },
  { code: 'ID', name: 'Indonesia', symbol: 'Rp', currency: 'IDR' },
  { code: 'IR', name: 'Iran', symbol: '﷼', currency: 'IRR' },
  { code: 'IQ', name: 'Iraq', symbol: 'ID', currency: 'IQD' },
  { code: 'IE', name: 'Ireland', symbol: '€', currency: 'EUR' },
  { code: 'IL', name: 'Israel', symbol: '₪', currency: 'ILS' },
  { code: 'IT', name: 'Italy', symbol: '€', currency: 'EUR' },
  { code: 'JM', name: 'Jamaica', symbol: 'J$', currency: 'JMD' },
  { code: 'JP', name: 'Japan', symbol: '¥', currency: 'JPY' },
  { code: 'JO', name: 'Jordan', symbol: 'JD', currency: 'JOD' },
  { code: 'KZ', name: 'Kazakhstan', symbol: '₸', currency: 'KZT' },
  { code: 'KE', name: 'Kenya', symbol: 'KSh', currency: 'KES' },
  { code: 'KI', name: 'Kiribati', symbol: 'A$', currency: 'AUD' },
  { code: 'KP', name: 'North Korea', symbol: '₩', currency: 'KPW' },
  { code: 'KR', name: 'South Korea', symbol: '₩', currency: 'KRW' },
  { code: 'KW', name: 'Kuwait', symbol: 'KD', currency: 'KWD' },
  { code: 'KG', name: 'Kyrgyzstan', symbol: 'с', currency: 'KGS' },
  { code: 'LA', name: 'Laos', symbol: '₭', currency: 'LAK' },
  { code: 'LV', name: 'Latvia', symbol: '€', currency: 'EUR' },
  { code: 'LB', name: 'Lebanon', symbol: 'LL', currency: 'LBP' },
  { code: 'LS', name: 'Lesotho', symbol: 'L', currency: 'LSL' },
  { code: 'LR', name: 'Liberia', symbol: 'L$', currency: 'LRD' },
  { code: 'LY', name: 'Libya', symbol: 'LD', currency: 'LYD' },
  { code: 'LI', name: 'Liechtenstein', symbol: 'CHF', currency: 'CHF' },
  { code: 'LT', name: 'Lithuania', symbol: '€', currency: 'EUR' },
  { code: 'LU', name: 'Luxembourg', symbol: '€', currency: 'EUR' },
  { code: 'MO', name: 'Macau', symbol: 'MOP', currency: 'MOP' },
  { code: 'MG', name: 'Madagascar', symbol: 'Ar', currency: 'MGA' },
  { code: 'MW', name: 'Malawi', symbol: 'MK', currency: 'MWK' },
  { code: 'MY', name: 'Malaysia', symbol: 'RM', currency: 'MYR' },
  { code: 'MV', name: 'Maldives', symbol: 'Rf', currency: 'MVR' },
  { code: 'ML', name: 'Mali', symbol: 'CFA', currency: 'XOF' },
  { code: 'MT', name: 'Malta', symbol: '€', currency: 'EUR' },
  { code: 'MH', name: 'Marshall Islands', symbol: '$', currency: 'USD' },
  { code: 'MQ', name: 'Martinique', symbol: '€', currency: 'EUR' },
  { code: 'MR', name: 'Mauritania', symbol: 'UM', currency: 'MRU' },
  { code: 'MU', name: 'Mauritius', symbol: 'Rs', currency: 'MUR' },
  { code: 'MX', name: 'Mexico', symbol: '$', currency: 'MXN' },
  { code: 'FM', name: 'Micronesia', symbol: '$', currency: 'USD' },
  { code: 'MD', name: 'Moldova', symbol: 'L', currency: 'MDL' },
  { code: 'MC', name: 'Monaco', symbol: '€', currency: 'EUR' },
  { code: 'MN', name: 'Mongolia', symbol: '₮', currency: 'MNT' },
  { code: 'ME', name: 'Montenegro', symbol: '€', currency: 'EUR' },
  { code: 'MS', name: 'Montserrat', symbol: 'EC$', currency: 'XCD' },
  { code: 'MA', name: 'Morocco', symbol: 'DH', currency: 'MAD' },
  { code: 'MZ', name: 'Mozambique', symbol: 'MT', currency: 'MZN' },
  { code: 'MM', name: 'Myanmar', symbol: 'K', currency: 'MMK' },
  { code: 'NA', name: 'Namibia', symbol: 'N$', currency: 'NAD' },
  { code: 'NR', name: 'Nauru', symbol: 'A$', currency: 'AUD' },
  { code: 'NP', name: 'Nepal', symbol: 'Rs', currency: 'NPR' },
  { code: 'NL', name: 'Netherlands', symbol: '€', currency: 'EUR' },
  { code: 'NC', name: 'New Caledonia', symbol: 'F', currency: 'XPF' },
  { code: 'NZ', name: 'New Zealand', symbol: 'NZ$', currency: 'NZD' },
  { code: 'NI', name: 'Nicaragua', symbol: 'C$', currency: 'NIO' },
  { code: 'NE', name: 'Niger', symbol: 'CFA', currency: 'XOF' },
  { code: 'NG', name: 'Nigeria', symbol: '₦', currency: 'NGN' },
  { code: 'MK', name: 'North Macedonia', symbol: 'ден', currency: 'MKD' },
  { code: 'NO', name: 'Norway', symbol: 'kr', currency: 'NOK' },
  { code: 'OM', name: 'Oman', symbol: 'OR', currency: 'OMR' },
  { code: 'PK', name: 'Pakistan', symbol: 'Rs', currency: 'PKR' },
  { code: 'PW', name: 'Palau', symbol: '$', currency: 'USD' },
  { code: 'PS', name: 'Palestine', symbol: '₪', currency: 'ILS' },
  { code: 'PA', name: 'Panama', symbol: 'B/.', currency: 'PAB' },
  { code: 'PG', name: 'Papua New Guinea', symbol: 'K', currency: 'PGK' },
  { code: 'PY', name: 'Paraguay', symbol: '₲', currency: 'PYG' },
  { code: 'PE', name: 'Peru', symbol: 'S/', currency: 'PEN' },
  { code: 'PH', name: 'Philippines', symbol: '₱', currency: 'PHP' },
  { code: 'PL', name: 'Poland', symbol: 'zł', currency: 'PLN' },
  { code: 'PT', name: 'Portugal', symbol: '€', currency: 'EUR' },
  { code: 'PR', name: 'Puerto Rico', symbol: '$', currency: 'USD' },
  { code: 'QA', name: 'Qatar', symbol: 'QR', currency: 'QAR' },
  { code: 'RE', name: 'Réunion', symbol: '€', currency: 'EUR' },
  { code: 'RO', name: 'Romania', symbol: 'lei', currency: 'RON' },
  { code: 'RU', name: 'Russia', symbol: '₽', currency: 'RUB' },
  { code: 'RW', name: 'Rwanda', symbol: 'RF', currency: 'RWF' },
  { code: 'WS', name: 'Samoa', symbol: 'WS$', currency: 'WST' },
  { code: 'SM', name: 'San Marino', symbol: '€', currency: 'EUR' },
  { code: 'ST', name: 'São Tomé and Príncipe', symbol: 'Db', currency: 'STN' },
  { code: 'SA', name: 'Saudi Arabia', symbol: 'SAR', currency: 'SAR' },
  { code: 'SN', name: 'Senegal', symbol: 'CFA', currency: 'XOF' },
  { code: 'RS', name: 'Serbia', symbol: 'din', currency: 'RSD' },
  { code: 'SC', name: 'Seychelles', symbol: 'SR', currency: 'SCR' },
  { code: 'SL', name: 'Sierra Leone', symbol: 'Le', currency: 'SLE' },
  { code: 'SG', name: 'Singapore', symbol: 'S$', currency: 'SGD' },
  { code: 'SK', name: 'Slovakia', symbol: '€', currency: 'EUR' },
  { code: 'SI', name: 'Slovenia', symbol: '€', currency: 'EUR' },
  { code: 'SB', name: 'Solomon Islands', symbol: 'SI$', currency: 'SBD' },
  { code: 'SO', name: 'Somalia', symbol: 'Sh', currency: 'SOS' },
  { code: 'ZA', name: 'South Africa', symbol: 'R', currency: 'ZAR' },
  { code: 'SS', name: 'South Sudan', symbol: 'SS£', currency: 'SSP' },
  { code: 'ES', name: 'Spain', symbol: '€', currency: 'EUR' },
  { code: 'LK', name: 'Sri Lanka', symbol: 'Rs', currency: 'LKR' },
  { code: 'KN', name: 'Saint Kitts and Nevis', symbol: 'EC$', currency: 'XCD' },
  { code: 'LC', name: 'Saint Lucia', symbol: 'EC$', currency: 'XCD' },
  { code: 'VC', name: 'Saint Vincent and the Grenadines', symbol: 'EC$', currency: 'XCD' },
  { code: 'SD', name: 'Sudan', symbol: 'SDG', currency: 'SDG' },
  { code: 'SR', name: 'Suriname', symbol: 'Sr$', currency: 'SRD' },
  { code: 'SE', name: 'Sweden', symbol: 'kr', currency: 'SEK' },
  { code: 'CH', name: 'Switzerland', symbol: 'CHF', currency: 'CHF' },
  { code: 'SY', name: 'Syria', symbol: 'SP', currency: 'SYP' },
  { code: 'TW', name: 'Taiwan', symbol: 'NT$', currency: 'TWD' },
  { code: 'TJ', name: 'Tajikistan', symbol: 'SM', currency: 'TJS' },
  { code: 'TZ', name: 'Tanzania', symbol: 'TSh', currency: 'TZS' },
  { code: 'TH', name: 'Thailand', symbol: '฿', currency: 'THB' },
  { code: 'TL', name: 'Timor-Leste', symbol: '$', currency: 'USD' },
  { code: 'TG', name: 'Togo', symbol: 'CFA', currency: 'XOF' },
  { code: 'TO', name: 'Tonga', symbol: 'T$', currency: 'TOP' },
  { code: 'TT', name: 'Trinidad and Tobago', symbol: 'TT$', currency: 'TTD' },
  { code: 'TN', name: 'Tunisia', symbol: 'DT', currency: 'TND' },
  { code: 'TR', name: 'Turkey', symbol: '₺', currency: 'TRY' },
  { code: 'TM', name: 'Turkmenistan', symbol: 'T', currency: 'TMT' },
  { code: 'TC', name: 'Turks and Caicos', symbol: '$', currency: 'USD' },
  { code: 'TV', name: 'Tuvalu', symbol: 'A$', currency: 'AUD' },
  { code: 'UG', name: 'Uganda', symbol: 'USh', currency: 'UGX' },
  { code: 'UA', name: 'Ukraine', symbol: '₴', currency: 'UAH' },
  { code: 'AE', name: 'United Arab Emirates', symbol: 'AED', currency: 'AED' },
  { code: 'GB', name: 'United Kingdom', symbol: '£', currency: 'GBP' },
  { code: 'US', name: 'United States', symbol: '$', currency: 'USD' },
  { code: 'UY', name: 'Uruguay', symbol: '$U', currency: 'UYU' },
  { code: 'UZ', name: 'Uzbekistan', symbol: 'sum', currency: 'UZS' },
  { code: 'VU', name: 'Vanuatu', symbol: 'VT', currency: 'VUV' },
  { code: 'VA', name: 'Vatican City', symbol: '€', currency: 'EUR' },
  { code: 'VE', name: 'Venezuela', symbol: 'Bs', currency: 'VES' },
  { code: 'VN', name: 'Vietnam', symbol: '₫', currency: 'VND' },
  { code: 'VG', name: 'British Virgin Islands', symbol: '$', currency: 'USD' },
  { code: 'VI', name: 'U.S. Virgin Islands', symbol: '$', currency: 'USD' },
  { code: 'YE', name: 'Yemen', symbol: 'YR', currency: 'YER' },
  { code: 'ZM', name: 'Zambia', symbol: 'ZK', currency: 'ZMW' },
  { code: 'ZW', name: 'Zimbabwe', symbol: 'Z$', currency: 'ZWL' },
].sort((a, b) => a.name.localeCompare(b.name));

interface Country {
  id: string;
  country_code: string;
  country_name: string;
  currency_symbol: string;
  is_active: boolean;
}

interface Card {
  id: string;
  name: string;
  logo_url: string | null;
  is_active: boolean;
  sort_order: number;
  countries: Country[];
}

export default function CardsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);

  // Card modal
  const [showCardModal, setShowCardModal] = useState(false);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [cardName, setCardName] = useState('');
  const [cardActive, setCardActive] = useState(true);
  const [logoUrl, setLogoUrl] = useState('');
  const [logoPreview, setLogoPreview] = useState('');
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [cardError, setCardError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Countries panel
  const [countriesCard, setCountriesCard] = useState<Card | null>(null);
  const [newCountryCode, setNewCountryCode] = useState('');
  const [newCurrencySymbol, setNewCurrencySymbol] = useState('');
  const [newCurrencyName, setNewCurrencyName] = useState('');
  const [newCountryActive, setNewCountryActive] = useState(true);
  const [addingCountry, setAddingCountry] = useState(false);

  useEffect(() => { fetchCards(); }, []);

  const fetchCards = async () => {
    setLoading(true);
    const res = await fetch('/api/cards');
    const data = await res.json();
    setCards(data.cards || []);
    setLoading(false);
  };

  const openCreate = () => {
    setEditCard(null);
    setCardName(''); setCardActive(true); setLogoUrl(''); setLogoPreview(''); setCardError('');
    setShowCardModal(true);
  };

  const openEdit = (card: Card) => {
    setEditCard(card);
    setCardName(card.name); setCardActive(card.is_active);
    setLogoUrl(card.logo_url || ''); setLogoPreview(card.logo_url || ''); setCardError('');
    setShowCardModal(true);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch('/api/cards/upload', { method: 'POST', body: formData });
    const data = await res.json();
    setUploading(false);
    if (data.url) { setLogoUrl(data.url); setLogoPreview(data.url); }
  };

  const handleSaveCard = async () => {
    if (!cardName.trim()) { setCardError('Card name is required.'); return; }
    setSaving(true);
    setCardError('');
    const method = editCard ? 'PATCH' : 'POST';
    const body = editCard
      ? { type: 'card', id: editCard.id, name: cardName, is_active: cardActive, logo_url: logoUrl || null }
      : { type: 'card', name: cardName, is_active: cardActive, logo_url: logoUrl || null };
    const res = await fetch('/api/cards', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setCardError(data.error || 'Failed to save.'); return; }
    setShowCardModal(false);
    fetchCards();
  };

  const handleToggleCard = async (card: Card) => {
    await fetch('/api/cards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'card', id: card.id, is_active: !card.is_active }),
    });
    fetchCards();
  };

  const openCountries = (card: Card) => {
    setCountriesCard(card);
    setNewCountryCode(''); setNewCurrencySymbol(''); setNewCurrencyName(''); setNewCountryActive(true);
  };

  const handleAddCountry = async () => {
    if (!newCountryCode || !newCurrencySymbol || !newCurrencyName) return;
    setAddingCountry(true);
    const countryName = ISO_COUNTRIES.find((c) => c.code === newCountryCode)?.name || newCountryCode;
    await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'country',
        card_id: countriesCard!.id,
        country_code: newCountryCode,
        country_name: countryName,
        currency_symbol: newCurrencySymbol,
        is_active: newCountryActive,
      }),
    });
    setAddingCountry(false);
    setNewCountryCode(''); setNewCurrencySymbol(''); setNewCurrencyName('');
    await fetchCards();
    setCountriesCard((prev) => {
      const updated = cards.find((c) => c.id === prev?.id);
      return updated || prev;
    });
  };

  const handleToggleCountry = async (country: Country) => {
    await fetch('/api/cards', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'country', id: country.id, is_active: !country.is_active }),
    });
    fetchCards();
  };

  const handleRemoveCountry = async (country: Country) => {
    await fetch('/api/cards', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'country', id: country.id }),
    });
    fetchCards();
  };

  const formatCountries = (countries: Country[]) => {
    if (!countries || countries.length === 0) return '-';
    const names = countries.map((c) => c.country_name);
    if (names.length <= 2) return names.join(', ');
    return names.slice(0, 2).join(', ') + '...';
  };

  // Sync countriesCard when cards refresh
  useEffect(() => {
    if (countriesCard) {
      const updated = cards.find((c) => c.id === countriesCard.id);
      if (updated) setCountriesCard(updated);
    }
  }, [cards]);

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.title}>Card & Country Management</span>
        <button style={styles.createBtn} onClick={openCreate}>+ Add Card Brand</button>
      </div>

      {/* Table */}
      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              {['Logo', 'Card Name', 'Countries', 'Status', 'Sort Order', 'Actions'].map((col) => (
                <th key={col} style={styles.th}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#888888' }}>Loading...</td></tr>
            ) : cards.length === 0 ? (
              <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: '#888888' }}>No card brands yet</td></tr>
            ) : cards.map((card, i) => (
              <tr key={card.id} style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F7F7F7' }}>
                <td style={styles.td}>
                  {card.logo_url
                    ? <img src={card.logo_url} alt={card.name} style={styles.logoThumb} />
                    : <div style={styles.logoPlaceholder} />
                  }
                </td>
                <td style={{ ...styles.td, fontWeight: 600 }}>{card.name}</td>
                <td style={styles.td}>{card.countries.length} ({formatCountries(card.countries)})</td>
                <td style={styles.td}>
                  <span style={card.is_active ? styles.badgeActive : styles.badgeInactive}>
                    {card.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={styles.td}>{card.sort_order}</td>
                <td style={styles.td}>
                  <div style={styles.actions}>
                    <button style={styles.editBtn} onClick={() => openEdit(card)}>Edit</button>
                    <button style={styles.manageBtn} onClick={() => openCountries(card)}>Countries</button>
                    <button style={styles.toggleBtn} onClick={() => handleToggleCard(card)}>
                      {card.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <span style={styles.dragHandle}>⠿</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Card Modal */}
      {showCardModal && (
        <>
          <div style={styles.modalOverlay} onClick={() => setShowCardModal(false)} />
          <div style={styles.modal}>
            <p style={styles.modalTitle}>{editCard ? 'Edit Card Brand' : 'Add Card Brand'}</p>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>CARD NAME</label>
              <input style={styles.input} value={cardName} onChange={(e) => setCardName(e.target.value)} />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>LOGO</label>
              <div
                style={styles.uploadBox}
                onClick={() => fileInputRef.current?.click()}
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="Logo preview" style={styles.logoPreview} />
                ) : (
                  <>
                    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#888888" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1={12} y1={3} x2={12} y2={15} />
                    </svg>
                    <span style={styles.uploadText}>{uploading ? 'Uploading...' : 'Upload Logo'}</span>
                  </>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoUpload} />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>ACTIVE</label>
              <div style={{ ...styles.toggle, backgroundColor: cardActive ? '#111111' : '#E0E0E0' }} onClick={() => setCardActive(!cardActive)}>
                <div style={{ ...styles.toggleThumb, left: cardActive ? 22 : 2 }} />
              </div>
            </div>

            {cardError && <p style={styles.formError}>{cardError}</p>}

            <div style={styles.modalActions}>
              <button style={styles.cancelBtn} onClick={() => setShowCardModal(false)}>Cancel</button>
              <button style={styles.saveBtn} onClick={handleSaveCard} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Manage Countries Panel */}
      {countriesCard && (
        <>
          <div style={styles.panelOverlay} onClick={() => setCountriesCard(null)} />
          <div style={styles.panel}>
            <p style={styles.panelTitle}>{countriesCard.name} — Countries</p>

            {/* Existing countries */}
            <div style={styles.countriesList}>
              {countriesCard.countries.length === 0 && (
                <p style={{ fontSize: 12, color: '#888888' }}>No countries added yet.</p>
              )}
              {countriesCard.countries.map((country) => (
                <div key={country.id} style={styles.countryRow}>
                  <div style={{ flex: 1 }}>
                    <span style={styles.countryName}>{country.country_name}</span>
                    <span style={styles.currencySymbol}> ({country.currency_symbol})</span>
                  </div>
                  <div
                    style={{ ...styles.toggle, backgroundColor: country.is_active ? '#111111' : '#E0E0E0' }}
                    onClick={() => handleToggleCountry(country)}
                  >
                    <div style={{ ...styles.toggleThumb, left: country.is_active ? 22 : 2 }} />
                  </div>
                  <button style={styles.removeBtn} onClick={() => handleRemoveCountry(country)}>Remove</button>
                </div>
              ))}
            </div>

            {/* Add country form */}
            <p style={{ ...styles.fieldLabel, marginTop: 16 }}>+ ADD COUNTRY</p>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>COUNTRY</label>
              <select style={styles.input} value={newCountryCode} onChange={(e) => {
                const code = e.target.value;
                setNewCountryCode(code);
                const iso = ISO_COUNTRIES.find((c) => c.code === code);
                if (iso) {
                  setNewCurrencySymbol(iso.symbol);
                  setNewCurrencyName(iso.currency);
                } else {
                  setNewCurrencySymbol('');
                  setNewCurrencyName('');
                }
              }}>
                <option value="">Select country</option>
                {ISO_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>CURRENCY SYMBOL</label>
              <input style={styles.input} maxLength={5} placeholder="e.g. $" value={newCurrencySymbol} onChange={(e) => setNewCurrencySymbol(e.target.value)} />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>CURRENCY NAME</label>
              <input style={styles.input} placeholder="e.g. USD" value={newCurrencyName} onChange={(e) => setNewCurrencyName(e.target.value)} />
            </div>

            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>ACTIVE</label>
              <div style={{ ...styles.toggle, backgroundColor: newCountryActive ? '#111111' : '#E0E0E0' }} onClick={() => setNewCountryActive(!newCountryActive)}>
                <div style={{ ...styles.toggleThumb, left: newCountryActive ? 22 : 2 }} />
              </div>
            </div>

            <button
              style={{ ...styles.saveBtn, width: '100%', marginTop: 8, opacity: (!newCountryCode || !newCurrencySymbol || !newCurrencyName) ? 0.5 : 1 }}
              onClick={handleAddCountry}
              disabled={!newCountryCode || !newCurrencySymbol || !newCurrencyName || addingCountry}
            >
              {addingCountry ? 'Adding...' : 'Add Country'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { position: 'relative' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  title: { fontSize: 15, fontWeight: 800, color: '#111111' },
  createBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 18px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  tableWrapper: { overflowX: 'auto', borderRadius: 10, border: '1px solid #EEEEEE' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { backgroundColor: '#111111', color: '#FFFFFF', fontSize: 12, fontWeight: 700, padding: '10px 12px', textAlign: 'left', whiteSpace: 'nowrap' },
  td: { padding: '10px 12px', color: '#333333', fontSize: 12, verticalAlign: 'middle' },
  logoThumb: { width: 32, height: 32, objectFit: 'contain', borderRadius: 4 },
  logoPlaceholder: { width: 32, height: 32, backgroundColor: '#F0F0F0', borderRadius: 4 },
  badgeActive: { backgroundColor: '#E8F5E9', color: '#2E7D32', padding: '3px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600 },
  badgeInactive: { backgroundColor: '#EBEBEB', color: '#888888', padding: '3px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600 },
  actions: { display: 'flex', gap: 6, alignItems: 'center' },
  editBtn: { backgroundColor: '#F3E5F5', color: '#6A1B9A', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  manageBtn: { backgroundColor: '#E3F2FD', color: '#1565C0', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  toggleBtn: { backgroundColor: '#FFF8E1', color: '#F9A825', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
  dragHandle: { fontSize: 16, color: '#CCCCCC', cursor: 'grab', userSelect: 'none' },
  modalOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 49 },
  modal: { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 24, width: 480, zIndex: 50, maxHeight: '90vh', overflowY: 'auto' },
  modalTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 20px' },
  fieldGroup: { marginBottom: 14 },
  fieldLabel: { display: 'block', fontSize: 11, fontWeight: 600, color: '#888888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
  input: { width: '100%', border: '1.5px solid #E8E8E8', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#111111', outline: 'none', boxSizing: 'border-box', backgroundColor: '#FFFFFF' },
  uploadBox: { width: 100, height: 100, border: '2px dashed #DEDEDE', borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: 6 },
  uploadText: { fontSize: 11, color: '#888888' },
  logoPreview: { width: 96, height: 96, objectFit: 'contain', borderRadius: 6 },
  toggle: { width: 44, height: 24, borderRadius: 100, position: 'relative', cursor: 'pointer', transition: 'background-color 0.25s', flexShrink: 0 },
  toggleThumb: { position: 'absolute', top: 2, width: 20, height: 20, borderRadius: '50%', backgroundColor: '#FFFFFF', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.25s' },
  formError: { fontSize: 12, color: '#E53935', margin: '8px 0' },
  modalActions: { display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  cancelBtn: { backgroundColor: '#F7F7F7', color: '#333333', border: 'none', borderRadius: 8, padding: '8px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  saveBtn: { backgroundColor: '#111111', color: '#FFFFFF', border: 'none', borderRadius: 100, padding: '8px 20px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  panelOverlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.2)', zIndex: 49 },
  panel: { position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, backgroundColor: '#FFFFFF', borderLeft: '1px solid #EEEEEE', padding: 24, zIndex: 50, overflowY: 'auto' },
  panelTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 16px' },
  countriesList: { display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 8 },
  countryRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F0F0F0' },
  countryName: { fontSize: 13, fontWeight: 600, color: '#111111' },
  currencySymbol: { fontSize: 12, color: '#888888' },
  removeBtn: { backgroundColor: '#FFEBEE', color: '#C62828', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' },
};
