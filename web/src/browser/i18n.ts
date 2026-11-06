import { formatMessage } from "mygo-runtime/i18n";
import ko from "./locales/ko.json";
export function makeT(_locale: string) {
  return (key: string, ...args: (string | number)[]) => {
    const k = key.replace(/[.-]/g, "_");
    const message = (ko as Record<string, string>)[k];
    if (!message) return key;
    const values = Object.fromEntries(args.map((v, i) => [`arg${i + 1}`, v]));
    return formatMessage("ko", message, values);
  };
}
