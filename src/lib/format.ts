export function formatDate(value: string, locale = "en") {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

export function percent(value: number) {
  return `${value.toFixed(2)}%`;
}
