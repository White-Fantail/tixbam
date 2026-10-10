import {useEffect,useState} from "react";
import type {TicketAddon} from "../types";
import {
  type AdvanceSettings,type AdvanceMode,type AdvanceKind,
  globalAdvanceSettings,planAdvanceSettings,saveGlobalAdvanceSettings,
  savePlanAdvanceSettings
} from "./advance-settings";
import {useLanguage} from "../i18n";
import {providerAutoClickEligibility} from "./provider-auto-click";

const choices: Array<{kind:AdvanceKind;ko:string;en:string}>=[
  {kind:"continue",ko:"다음 단계 / 예매 진입",en:"Continue / enter booking"},
  {kind:"performance",ko:"공연 회차",en:"Performance"},
  {kind:"price_tier",ko:"가격 등급",en:"Price tier"},
  {kind:"quantity",ko:"매수 선택",en:"Ticket quantity"},
  {kind:"seat",ko:"좌석 / 구역 선택",en:"Seat or section"}
];

export function AdvanceSettingsEditor({planId,provider}:{
  planId?:string;provider?:TicketAddon
}){
  const {language}=useLanguage(),ko=language==="ko";
  const [override,setOverride]=useState(()=>Boolean(planId && planAdvanceSettings(planId)));
  const [value,setValue]=useState<AdvanceSettings>(()=>
    planId ? planAdvanceSettings(planId)||globalAdvanceSettings() : globalAdvanceSettings());
  const [saved,setSaved]=useState(false);
  const [developerAvailable,setDeveloperAvailable]=useState(false);
  useEffect(()=>{
    let active=true;
    void window.tixbam?.copilotDeveloperCapabilities()
      .then(value=>{if(active)setDeveloperAvailable(value.singleClickTest===true);})
      .catch(()=>{if(active)setDeveloperAvailable(false);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    setOverride(Boolean(planId && planAdvanceSettings(planId)));
    setValue(planId?planAdvanceSettings(planId)||globalAdvanceSettings():globalAdvanceSettings());
    setSaved(false);
  },[planId]);
  const permission=providerAutoClickEligibility(provider);
  const developerCanTest=Boolean(planId && developerAvailable && provider?.kind==="ticketing");
  // Allow *configuring* a restricted provider in the explicitly enabled
  // developer runtime. The trusted main process still limits it to one click.
  const available=provider ? permission.allowed || developerCanTest : true;
  const effectiveMode=value.mode==="authorized" && !available ? "observe" : value.mode;
  function change(patch:Partial<AdvanceSettings>){
    setValue(v=>({...v,...patch}));setSaved(false);
    if(planId)setOverride(true);
  }
  const hasDevClickKind=value.actions.some(kind=>kind!=="continue");
  function save(){
    if(effectiveMode==="authorized" && developerCanTest && !hasDevClickKind){
      setSaved(false);return;
    }
    if(value.mode!=="manual" && !value.shareScreenshots){
      setSaved(false);return;
    }
    const safe={...value,mode:effectiveMode,
      developerClickTest:Boolean(developerCanTest &&
        (effectiveMode==="authorized" ||
         (effectiveMode==="observe" && value.developerClickTest)))};
    if(planId)savePlanAdvanceSettings(planId,safe);
    else saveGlobalAdvanceSettings(safe);
    setValue(safe);
    setSaved(true);
  }
  return <div className="settings-panel">
    <h3>{ko?"코파일럿 사전 승인":"Copilot advance authorization"}</h3>
    <p className="settings-note">{ko
      ?"예매 창을 열기 전에 자동으로 처리할 범위를 정해두세요. AI 화면 인식은 예매 창 시작 시 1회 동의받고, 세션 중 허용된 화면에서만 실행됩니다."
      :"Set your workflow before opening the booking window. Screen sharing is approved once per session, then limited to eligible pages."}</p>
    {planId&& <div className="plan-options"><label><input type="checkbox" checked={override}
      onChange={event=>{
        if(!event.target.checked){savePlanAdvanceSettings(planId,null);setOverride(false);setValue(globalAdvanceSettings());}
        else{setOverride(true);setSaved(false);}
      }}/>{ko?"이 공연만 별도 설정":"Override defaults for this booking"}</label></div>}
    <label>{ko?"진행 방식":"Assistance mode"}
      <select value={effectiveMode} onChange={event=>{
        const mode=event.target.value as AdvanceMode;
        change({mode,developerClickTest:mode==="authorized" && developerCanTest});
      }}
        disabled={Boolean(planId&&!override)}>
        <option value="manual">{ko?"수동 안내 (기본값)":"Manual guidance (default)"}</option>
        <option value="observe">{ko?"자동 화면 인식 및 버튼 안내":"Auto screen recognition and hints"}</option>
        <option value="authorized" disabled={!available}>{developerCanTest
          ? (ko?"자동 클릭 테스트 (개발자 모드 · 최대 1회)":"Automatic click test (developer mode · once)")
          : (ko?"허가된 예매처만 자동 클릭까지":"Auto clicks where the provider explicitly permits it")}</option>
      </select>
    </label>
    {developerCanTest && effectiveMode==="authorized" && !hasDevClickKind &&
      <p className="settings-note" role="alert">{ko
        ?"개발자 클릭 테스트에는 회차·가격 등급·매수·좌석 중 하나 이상을 선택해야 합니다. 예매 진입 버튼은 자동 클릭하지 않습니다."
        :"Select at least one performance, price tier, quantity or seat action. Booking-entry buttons are not auto-clicked."}</p>}
    <p className="settings-note" role="note">{provider && developerCanTest && !permission.allowed
      ? (ko
          ? "개발자 테스트에서만 자동 클릭 옵션을 설정할 수 있습니다. 이 예매처는 여전히 "+permission.reasonKo+" 실제 동작은 좌석 선택 단계의 AI 신뢰도 95% 이상 대상에 대해 최대 1회 클릭으로 제한됩니다."
          : "Developer test only: this provider remains restricted. The local diagnostic permits at most one 95%+ confidence click in the ticket-selection stage.")
      : provider && !available
        ? (ko ? "자동 클릭 설정 비활성화: "+permission.reasonKo+" 화면 안내는 이용할 수 있습니다."
          : "Auto click disabled: "+permission.reasonEn+" Visual guidance remains available.")
        : (ko?"자동 클릭은 검증된 예매처별 실행기와 정책을 통과한 경우에만 가능합니다."
          :"Clicks require an authorized, verified provider-specific executor.")}</p>
    <div className="plan-options">
      {choices.map(c=><label key={c.kind}><input type="checkbox"
        checked={value.actions.includes(c.kind)}
        disabled={Boolean(planId&&!override)}
        onChange={event=>change({actions:event.target.checked
          ? [...new Set([...value.actions,c.kind])]
          : value.actions.filter(kind=>kind!==c.kind)})}/>
        {ko?c.ko:c.en}</label>)}
    </div>
    <label className="plan-options"><input type="checkbox" checked={value.shareScreenshots}
      disabled={Boolean(planId&&!override)}
      onChange={event=>change({shareScreenshots:event.target.checked})}/>
      {ko
        ?"예매 세션 동안 허용된 화면 캡처를 TixBam API 및 외부 AI 모델로 자동 전송하는 데 동의"
        :"Allow approved booking-stage screenshots to be sent automatically to the TixBam API and external AI model during this session"}
    </label>
    {developerCanTest &&
      <div className="copilot-note">
        <strong>{ko?"개발자 클릭 진단 (로컬 실행 전용)":"Developer click diagnostic (local only)"}</strong>
        <label><input type="checkbox"
          disabled={!override || effectiveMode==="authorized" || effectiveMode==="manual"}
          checked={effectiveMode==="authorized" ||
            Boolean(value.developerClickTest && effectiveMode==="observe")}
          onChange={event=>change({developerClickTest:event.target.checked})}/>
          {ko
            ?"좌석 선택 화면에서 자동 클릭 최대 1회 테스트 (자동 클릭 테스트 모드에서는 필수)"
            :"Test at most one native click during ticket selection (required in auto-click test mode)"}
        </label>
        <p>{ko
          ?"이 테스트는 예매처 정책상의 자동화 허가를 뜻하지 않습니다. 클릭은 실제 사이트에 전달될 수 있습니다. 선택한 좌석 또는 매수가 바뀔 수 있으며 예매·결제는 수행하지 않습니다. 승인 후 첫 유효 후보가 나올 때까지 기다리며, 실행 후 자동으로 중지됩니다."
          :"This does not grant permission under provider terms. One real native click may change ticket selections; it will never submit a purchase. The diagnostic stops after a single attempt."}</p>
      </div>}
    <p className="settings-note">{ko
      ?"로그인·대기열·CAPTCHA·결제 단계에서는 중단합니다. 세션은 최대 15분, AI 분석 최대 5회이며 사용자가 언제든 중지할 수 있습니다. 자동 결제는 불가합니다."
      :"Stops at login, queue, CAPTCHA or checkout. Maximum 15 minutes / 5 automatic AI requests. Stop anytime; payment is never automatic."}</p>
    <div className="booking-actions"><button className="button button-outline"
      disabled={Boolean(planId&&!override) ||
        (developerCanTest && effectiveMode==="authorized" && !hasDevClickKind) ||
        (effectiveMode!=="manual" &&
        (!value.shareScreenshots || value.actions.length===0))}
      onClick={save}>{ko?"사전 승인 설정 저장":"Save advance settings"}</button></div>
    {saved&&<p role="status" className="copilot-note">{ko?"이 기기에 설정을 저장했습니다. 실제 실행 전에는 별도 동의를 받습니다.":"Saved on this device. Session consent is requested before launch."}</p>}
  </div>;
}
