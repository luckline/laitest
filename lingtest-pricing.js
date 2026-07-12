const API_BASE="https://timelens.cc";
const dialog=document.getElementById("leadDialog"),form=document.getElementById("leadForm"),message=document.getElementById("leadMessage");
document.querySelectorAll("[data-open-lead]").forEach(button=>button.addEventListener("click",()=>{form.elements.source.value=button.dataset.openLead||"pricing";message.textContent="";message.className="";dialog.showModal()}));
document.querySelector(".dialog-close").addEventListener("click",()=>dialog.close());
dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close()});
form.addEventListener("submit",async event=>{
  event.preventDefault();
  const submit=form.querySelector("button[type=submit]"),label=submit.textContent;
  submit.disabled=true;submit.textContent="正在提交…";message.textContent="";message.className="";
  try{
    const payload=Object.fromEntries(new FormData(form));
    const response=await fetch(`${API_BASE}/api/lingtest/leads`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.code!==0)throw new Error(data.message||"提交失败，请稍后重试");
    message.textContent="申请已收到，我们会尽快联系你。";message.className="success";form.reset();
    window.va?.("event",{name:"lingtest_lead_submitted",source:payload.source||"pricing"});
    setTimeout(()=>dialog.close(),1800);
  }catch(error){message.textContent=error.message||"提交失败，请稍后重试"}
  finally{submit.disabled=false;submit.textContent=label}
});
