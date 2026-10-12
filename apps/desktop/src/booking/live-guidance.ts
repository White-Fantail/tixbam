import type {CopilotAdvanceInfo, TicketWindow} from "../types";

// Pure, display-only guide: never modifies the provider phase or permissions.
// Visual hints are untrusted and may be stale; security decisions stay in main.
export type BookingGuide = {
  step:0|1|2|3; kind:"open"|"signin"|"queue"|"select"|"conflict"|"checkout"|"verify";
  title:string; instruction:string; caution:string; action:"open"|"focus"|"tools";
};
export function looksLikeSignIn(url:string):boolean {
  try {
    const u=new URL(url);
    return /^(accounts|login|auth)\./i.test(u.hostname) ||
      /(?:^|\/)(?:login|sign-?in|auth|captcha|verify)(?:[\/?#-]|$)/i.test(u.pathname);
  } catch{return false;}
}
export function bookingGuide(win:TicketWindow|undefined,advance:CopilotAdvanceInfo|null,
  ko:boolean, quantity=1):BookingGuide {
  const l=(kr:string,en:string)=>ko?kr:en;
  const count=Number.isSafeInteger(quantity)&&quantity>0?quantity:1;
  const one=count===1;
  if(!win)return {step:0,kind:"open",action:"open",
    title:l("공식 예매창을 열어주세요","Open the official booking window"),
    instruction:l(`예매할 공연과 ${count}장 목표를 확인하고 공식 예매 사이트를 여세요.`,
      `Confirm the event and ${count}-ticket target, then open the official site.`),
    caution:l("로그인과 본인 인증은 공식 예매창에서 직접 진행합니다.",
      "Sign-in and identity verification stay in the official window.")};
  const phase=win.phase||"preparing";
  const visual=advance?.providerStep;
  // Conservative: a reported checkout or human gate can show a warning,
  // but cannot grant click authority, mark a purchase or change a stage.
  // The user's declared queue and login screens override untrusted
  // visual labels. Never advance the progress rail from a model hint alone.
  if(phase==="queue"||phase==="waiting")return {step:1,kind:"queue",action:"focus",
    title:l("대기 중이에요. 공식 창을 유지하세요","Keep the official queue open"),
    instruction:l("순서가 도착하면 공식 사이트의 안내대로 진행하세요.",
      "Follow the official site when your turn arrives."),
    caution:l("새 창·새로고침은 대기 순서를 잃게 할 수 있습니다.",
      "New windows and refreshes may reset your queue position.")};
  if(looksLikeSignIn(win.url))return {step:0,kind:"signin",action:"focus",
    title:l("로그인 또는 인증을 완료하세요","Complete sign-in or verification"),
    instruction:l("로그인 화면으로 보입니다. 주소가 정확한지 확인한 후 공식 창에서 직접 진행하세요.",
      "This looks like a sign-in screen. Verify its address and proceed in the official window."),
    caution:l("TixBam은 로그인·인증 화면을 자동 클릭하거나 우회하지 않습니다.",
      "TixBam never auto-clicks or bypasses sign-in and verification.")};
  if(phase==="checkout"||phase==="verification"){
    const verify=phase==="verification";
    return {step:3,kind:verify?"verify":"checkout",action:"focus",
      title:verify?l("구매 내역과 영수증을 확인하세요","Verify receipt and order history")
        :l("좌석과 결제 조건을 확인하세요","Review seat and checkout details"),
      instruction:l("공식 창에서 공연·좌석·매수·수수료 포함 총액·잔여 시간을 확인하세요. 결제창 진입만으로 좌석이 확보된 것은 아닙니다.",
        "Verify performance, seats, quantity, total fees and time limit. Checkout is not proof of a hold."),
      caution:l("결제 결과가 불분명하면 다시 결제하지 마세요.",
        "Never retry a payment when its outcome is uncertain.")};
  }
  if(visual?.step==="checkout_unverified")return {
    step:phase==="selecting"?2:0,kind:"checkout",action:"focus",
    title:l("결제 화면으로 보일 수 있어요","This may be a checkout screen"),
    instruction:l("공식 예매창의 실제 단계를 확인하세요. 화면 인식만으로 좌석 보류나 결제를 확정하지 않습니다.",
      "Check the real provider screen. A visual hint cannot prove a hold or purchase."),
    caution:l("확인 전에는 좌석 클릭을 진행하지 마세요.",
      "Do not proceed with seat clicks before checking.")};
  if(visual?.step==="human_gate")
    return {step:0,kind:"signin",action:"focus",
      title:l("로그인 또는 인증을 완료하세요","Complete sign-in or verification"),
      instruction:l("로그인 화면으로 보입니다. 주소가 정확한지 확인한 후 공식 창에서 직접 진행하세요.",
        "This looks like a sign-in screen. Verify its address and proceed in the official window."),
      caution:l("TixBam은 로그인·인증 화면을 자동 클릭하거나 우회하지 않습니다.",
        "TixBam never auto-clicks or bypasses sign-in and verification.")};
  if(win.loadError!==null&&win.loadError!==undefined)
    return {step:0,kind:"signin",action:"focus",
      title:l("공식 예매창의 연결을 확인하세요","Check official window connection"),
      instruction:l("화면을 불러오지 못했습니다. 공식 창의 오류와 주소를 확인하세요.",
        "The page did not load. Check its address and error in the official window."),
      caution:l("대기 순서가 있다면 새로고침하지 마세요.",
        "Do not refresh when your queue position could be affected.")};
  if(phase==="selecting" && ["seat_conflict","sold_out"].includes(visual?.substep||""))
    return {step:2,kind:"conflict",action:"tools",
      title:l("다른 승인된 좌석 후보를 찾아보세요","Review another approved seat option"),
      instruction:l("선택 충돌 또는 매진 표시가 감지됐습니다. 같은 좌석을 반복 누르지 말고 공식 화면에서 다른 후보를 확인하세요.",
        "A conflict or sold-out hint appeared. Do not retry the same seat blindly; inspect alternatives."),
      caution:l("AI 판단은 좌석의 실제 재고·보류를 확인한 것이 아닙니다.",
        "AI hints do not verify seat stock or holds.")};
  if(phase==="selecting")return {step:2,kind:"select",action:"tools",
    title:one?l("1장 확보를 목표로 좌석을 고르세요","Choose one eligible ticket first"):
      l(`${count}장을 확보할 좌석을 고르세요`,`Choose seats for ${count} tickets`),
    instruction:one?l("선호 구역보다 예산 이내의 1장 확보를 우선하세요. 화면 분석 도구로 버튼 위치 안내를 받을 수 있습니다.",
      "Prioritize one ticket within budget. Use the screen guide to find candidate buttons."):
      l("공식 예매처에서 설정한 매수와 예산을 먼저 확인하세요. 화면 분석은 버튼 위치 안내에만 사용하세요.",
        "Verify the requested quantity and budget on the official site. Screen analysis only suggests buttons."),
    caution:l("최종 가격과 실제 좌석 확보는 공식 예매창에서 확인하세요.",
      "Verify prices and any actual hold in the official window.")};
  return {step:0,kind:"signin",action:"focus",
    title:l("공연과 로그인 상태를 확인하세요","Verify the event and sign-in"),
    instruction:l("공연·날짜·회차가 맞는지 확인하고 공식 사이트에서 예매 단계로 진행하세요.",
      "Check the event, date and performance, then proceed in the official site."),
    caution:l("좌석 선택 화면까지 이동했을 때만 다음 단계를 선택하세요.",
      "Only mark seat selection after the real selection page appears.")};
}
