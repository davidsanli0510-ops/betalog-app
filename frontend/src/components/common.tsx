import { useToast } from '../data/store';

export function Toast() {
  const t = useToast();
  return t ? <div className="toast" role="status">{t.text}</div> : null;
}
