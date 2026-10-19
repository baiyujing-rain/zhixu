'use client';

import { useEffect, useState } from 'react';
import { readSource, subscribeApiSource, type ApiSource } from '@/lib/api-cache';

/** Subscribe to the read-cache data source so UI can show an offline hint. */
export function useApiSource(): ApiSource {
  const [source, setSource] = useState<ApiSource>(() => readSource());
  useEffect(() => subscribeApiSource(setSource), []);
  return source;
}
