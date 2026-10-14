/** 信件內容（純文字）。日期用民國紀年。 */
import { roc, spaced, tp, type ReturnPostmark } from '@manxin/engine';

const when = (t: number) => `民國 ${roc(t).replace(/\./g, '/')} ${tp(t).toFormat('HH:mm')}`;

export function deliveryMail(o: {
  fromName: string;
  postcard: boolean;
  sentAt: number;
  office: string;
  link: string;
}) {
  return {
    subject: '【慢信】有人給你寄了一封信',
    text: [
      `${o.fromName || '有個人'}寫了一封${o.postcard ? '明信片' : '信'}給你，${when(o.sentAt)}從${o.office}寄出，現在送到了。`,
      '',
      '信不會自己打開。點下面的連結，親手拆開它：',
      o.link,
      '',
      '（這個連結只屬於你，請不要轉寄。）',
    ].join('\n'),
  };
}

export function remindMail(o: { which: 24 | 48; no: string; toLabel: string; trackLink: string }) {
  return {
    subject: `${o.which}小時未簽收，請確認電子信箱是否正確`,
    text: [
      o.which === 24
        ? `你寄給 ${o.toLabel} 的信（${spaced(o.no)}）已送達 24 小時，還沒有人簽收。可以修改一次收件信箱。`
        : `你寄給 ${o.toLabel} 的信（${spaced(o.no)}）已送達 48 小時，還沒有人簽收。這是最後一次可以修改收件信箱的機會。`,
      '',
      `查看與修改：${o.trackLink}`,
    ].join('\n'),
  };
}

export function returnMail(o: { no: string; dest: string; pm: ReturnPostmark; trackLink: string }) {
  return {
    subject: '你的信被退回了',
    text: [
      `送達 30 天無人簽收，信件（${spaced(o.no)}）已退回。`,
      `退件郵戳：${o.pm.place}　${o.pm.date}`,
      '',
      `查看：${o.trackLink}`,
    ].join('\n'),
  };
}

export function unsentAskMail(o: { toName: string; shelvedAt: number; days: number; deskLink: string }) {
  return {
    subject: '之前寫的那封信現在想寄出了嗎？',
    text: [
      `${when(o.shelvedAt)} 寫給${o.toName || '某個人'}的那封信，已經放了 ${o.days} 天。`,
      '現在想寄出了嗎？',
      '',
      `回到書桌：${o.deskLink}`,
    ].join('\n'),
  };
}

export function magicLinkMail(o: { link: string; minutes: number }) {
  return {
    subject: '【慢信】登入連結',
    text: [`點下面的連結登入慢信（${o.minutes} 分鐘內有效，只能用一次）：`, o.link, '', '如果不是你本人要求的，請忽略這封信。'].join('\n'),
  };
}
