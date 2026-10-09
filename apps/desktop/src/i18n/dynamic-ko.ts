// User-facing messages with runtime values; avoid changing the underlying
// currency, seat-count, status or booking validation rules.
export function dynamicKo(source: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = source.match(/^Select exactly (\d+) tickets?\.$/)))
    return "티켓 " + m[1] + "장을 정확히 선택하세요.";
  if ((m = source.match(/^This practice event allows up to (\d+) tickets per order\.$/)))
    return "이 연습용 공연은 주문당 최대 " + m[1] + "장까지 구매할 수 있어요.";
  if ((m = source.match(/^Total including fees exceeds your limit by (.+)\. Choose another price zone or delivery option\.$/)))
    return "수수료 포함 총액이 예산을 " + m[1] + " 초과해요. 다른 가격 구역이나 수령 방법을 선택하세요.";
  if ((m = source.match(/^This provider allows up to (\d+) tickets\. Update your Booking Plan quantity before continuing\.$/)))
    return "이 예매처는 최대 " + m[1] + "장까지 허용해요. 계속하기 전에 예매 계획의 수량을 수정하세요.";
  if ((m = source.match(/^Plan currency ([A-Z]{3}) differs from the provider currency ([A-Z]{3})\. Change your Booking Plan currency and re-enter its budget\.$/)))
    return "예매 계획의 통화(" + m[1] + ")와 예매처 통화(" + m[2] + ")가 달라요. 예매 계획에서 통화와 예산을 다시 설정하세요.";
  if ((m = source.match(/^Your plan is in ([A-Z]{3}), but this Cityline practice uses HKD\.$/)))
    return "예매 계획은 " + m[1] + "로 설정되어 있지만 Cityline 연습에서는 HKD를 사용해요.";
  if ((m = source.match(/^Opens in (\d+)d (\d+)h$/)))
    return m[1] + "일 " + m[2] + "시간 후 오픈";
  if ((m = source.match(/^Opens in (\d+)h (\d+)m$/)))
    return m[1] + "시간 " + m[2] + "분 후 오픈";
  if ((m = source.match(/^Opens in (\d+)m$/)))
    return m[1] + "분 후 오픈";
  if ((m = source.match(/^D-(\d+) until sale$/)))
    return "예매까지 D-" + m[1];
  return null;
}
