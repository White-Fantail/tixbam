'use strict';
/** Synthetic cart observer/allocator. Never calls a browser, website, or bank. */
class ExpressRehearsalAdapter{
  constructor({scope,preferences,order,kind='express',clock=Date.now}){
    this.scope=structuredClone(scope);this.preferences=structuredClone(preferences);
    this.order=structuredClone(order);this.kind=kind;this.clock=clock;
    this.stage='options';this.requests=0;
  }
  async selectOptions(){this.stage='allocation';return true;}
  async read(){return this.peek();}
  peek(){
    const s=this.scope;
    return {eventKey:s.eventKey,providerId:s.providerId,providerEventId:s.providerEventId,
      performance:s.providerPerformanceId,sessionId:s.sessionId,generation:s.generation,
      observedAtMs:this.clock(),stage:this.stage,challengeType:'none',
      allocation:{id:'synthetic-express-target',mode:'express',available:true,
        currency:this.preferences.currency,priceTier:this.preferences.options.priceTier[0],maxPerOrder:20},
      ...(this.stage==='cart'?{order:this.order,hold:{source:'provider-cart',
        status:this.kind==='express_missing_hold'?'unknown':'held',reference:'SYNTHETIC-NO-TICKET',
        orderId:this.order.id,providerEventId:s.providerEventId,performance:s.providerPerformanceId,
        expiresAtMs:this.kind==='express_expired'?this.clock()-1:this.clock()+120000}}:{})};
  }
  async allocate(request,{signal}={}){
    if(signal?.aborted||this.clock()>=request.deadlineMs||this.stage!=='allocation'||
      request.generation!==this.scope.generation)throw Error('Synthetic allocation stale');
    if(++this.requests!==1)throw Error('Duplicate synthetic allocation');
    this.stage='cart';
    if(this.kind==='express_timeout')throw Error('Synthetic reservation response lost');
    if(this.kind==='express_separated')this.order.adjacent=false;
  }
}
module.exports={ExpressRehearsalAdapter};
