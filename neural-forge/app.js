document.addEventListener("DOMContentLoaded",()=>{
  if(window.lucide)window.lucide.createIcons();
  const counter=document.querySelector("[data-counter]");
  if(!counter)return;
  const target=Number(counter.dataset.counter);let value=0;
  const tick=()=>{value=Math.min(target,value+Math.max(1,Math.ceil((target-value)/12)));counter.textContent=String(value).padStart(3,"0");if(value<target)requestAnimationFrame(tick)};
  requestAnimationFrame(tick);
});
