import { AtSign, Code2, Globe, Wallet, FileText, Image, Mail } from 'lucide-react';
import type { PublicRecord } from '../../shared/types';

export function RecordIcon({ record, size = 16 }: { record: PublicRecord; size?: number }) {
  const Icon =
    record.kind === 'address'
      ? Wallet
      : record.key === 'com.github'
        ? Code2
        : record.key === 'com.twitter'
          ? AtSign
          : record.key === 'url'
            ? Globe
            : record.key === 'email'
              ? Mail
              : record.key === 'avatar'
                ? Image
                : FileText;
  return <Icon size={size} aria-hidden="true" />;
}
