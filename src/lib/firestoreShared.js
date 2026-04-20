export function sortByTimestamp(items, key) {
  return [...items].sort((a, b) => {
    const first = typeof a?.[key]?.toDate === 'function' ? a[key].toDate().getTime() : new Date(a?.[key] ?? 0).getTime();
    const second = typeof b?.[key]?.toDate === 'function' ? b[key].toDate().getTime() : new Date(b?.[key] ?? 0).getTime();
    return second - first;
  });
}
