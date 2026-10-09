import {
  combineCodecs, dateRangeParam, enumParam, intParam, sortParam, stringParam, urlParam, uuidParam,
} from '../../_ui';
import { DEFAULT_SORT, DEFAULT_TAB, FLAG_SORT_KEYS, SEARCH_MAX, TAB_VALUES, typeParam } from './model';

export const SEARCH_CODEC = stringParam('search', { maxLength: SEARCH_MAX });

export const FLAGS_URL = combineCodecs({
  tab: enumParam('tab', TAB_VALUES, DEFAULT_TAB),
  search: SEARCH_CODEC,
  type: urlParam('type', { parse: typeParam, format: (value: string) => typeParam(value) || null }),
  range: dateRangeParam(),
  sort: sortParam({ allowed: FLAG_SORT_KEYS, default: DEFAULT_SORT }),
  page: intParam('page', { min: 1, default: 1 }),
  id: uuidParam('id'),
});

export type FlagsUrl = ReturnType<typeof FLAGS_URL.parse>;

export function searchKey(value: string): string {
  return SEARCH_CODEC.parse(new URLSearchParams({ search: value }));
}
