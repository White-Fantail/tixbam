import type { TicketAddon } from "../types";

/** UI hint only. Electron rechecks permissions independently before every native action. */
export function providerAutoClickEligibility(addon:TicketAddon|undefined):{allowed:boolean;reasonKo:string;reasonEn:string}{
  if(!addon)return {allowed:false,reasonKo:"예매처 정보가 없어 자동 클릭을 사용할 수 없습니다.",reasonEn:"Provider information is missing."};
  if(addon.kind!=="ticketing" || addon.automation.level2.status==="delegated")
    return {allowed:false,reasonKo:"다른 공식 예매처에서 판매하는 이벤트입니다. 이 애드온에서는 자동 클릭할 수 없습니다.",reasonEn:"This event uses another ticketing provider."};
  if(addon.automation.level2.status==="restricted" || addon.bookingAssistance?.mode==="manual")
    return {allowed:false,reasonKo:"예매처 정책상 자동 클릭이 제한됩니다.",reasonEn:"Automatic clicks are restricted by this provider's policy."};
  if(addon.automation.level2.status!=="available")
    return {allowed:false,reasonKo:"예매처의 자동 클릭 허용 여부가 검증되지 않았습니다.",reasonEn:"Permission for automated clicks has not been verified."};
  if(addon.booking?.implementation.seats!=="verified" ||
    addon.automation.verifiedNativeExecutor!=="host-reviewed-v1" ||
    !addon.automation.verifiedActionKinds?.includes("seat"))
    return {allowed:false,reasonKo:"자동 클릭을 위한 검증된 애드온 실행기가 아직 없습니다.",reasonEn:"No audited native click executor has been installed for this provider."};
  return {allowed:true,reasonKo:"검증된 예매처 동작만 자동 실행할 수 있습니다.",reasonEn:"Only verified provider actions may run automatically."};
}
