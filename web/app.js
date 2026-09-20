'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const token = new URLSearchParams(location.hash.slice(1)).get('session');
  const fields = new Map();
  const variants = [];
  let controlSequence = 0;
  let model;
  let busy = false;
  const unescapePointer = s => s.replace(/~1/g, '/').replace(/~0/g, '~');
  const escapePointer = s => s.replace(/~/g, '~0').replace(/\//g, '~1');
  function element(tag, attrs = {}, text) {
    const e = document.createElement(tag);
    for (const [k,v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  async function api(path, data) {
    const headers = {Authorization: 'Bearer ' + token};
    const options = {method: data === undefined ? 'GET' : 'POST', headers, credentials:'omit', cache:'no-store'};
    if (data !== undefined) { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(data); }
    const res = await fetch(path, options);
    const body = await res.json();
    if (!res.ok) { const err = new Error(body.error || '操作失败'); err.fields = body.fields; throw err; }
    return body;
  }
  function showError(err) {
    $('error').textContent = err.message || String(err);
    $('error').classList.remove('hidden');
    if (err.fields) for (const [key, message] of Object.entries(err.fields)) {
      const field = fields.get(key); if (!field) continue;
      field.wrapper.classList.add('invalid');
      field.wrapper.append(element('p', {class:'field-error'}, message));
    }
  }
  function clearErrors() {
    $('error').classList.add('hidden');
    document.querySelectorAll('.field-error').forEach(e=>e.remove());
    document.querySelectorAll('.invalid').forEach(e=>e.classList.remove('invalid'));
  }
  function appendHelp(wrapper, control, fallback) {
    if (control.help) {
      const help=element('div',{class:'help rich-help'});help.innerHTML=control.help.content;wrapper.append(help);
    } else if(fallback) wrapper.append(element('p',{class:'help'},fallback));
  }
  function setFieldDisabled(field) {
    const inactive=field.active===false;
    if(field.mode) {
      field.mode.disabled=busy||inactive;
      field.input.disabled=busy||inactive||field.mode.value!=='replace';
    } else field.input.disabled=busy||inactive;
    if(!field.secret&&field.required&&field.prop.type!=='boolean')field.input.required=!busy&&!inactive;
  }
  function setBusy(value, action='save') {
    busy=value;
    for(const b of [$('save'),$('cancel'),$('verify')]) b.disabled=value;
    for(const f of fields.values())setFieldDisabled(f);
    $('save').textContent=value&&action==='save'?(model.verification.enabled?'正在验证并保存…':'正在保存…'):model.submitLabel;
    $('verify').textContent=value&&action==='verify'?'正在测试…':'测试连接';
  }
  function renderControl(u, container, required=false) {
    const wrapper=element('div',{class:'field'}), id='field-'+controlSequence++;
    if(u.kind==='secret') {
      const p=model.form.secrets[u.key], exists=model.secretStates[u.key];
      const isRequired=required||p.required;
      wrapper.append(element('label',{for:id},p.label+(isRequired?' *':'')));
      const row=element('div',{class:'secret-row'}), mode=element('select',{'aria-label':p.label+'更新方式'});
      mode.append(element('option',{value:'keep'},exists?'保留原凭据':'暂不填写'),element('option',{value:'replace'},'输入新凭据'),element('option',{value:'delete'},'删除凭据'));
      mode.value=exists?'keep':'replace';
      const input=element('input',{id,type:'password',autocomplete:'new-password',placeholder:exists?'原凭据不会回填':'请输入凭据'});
      input.disabled=mode.value!=='replace';
      mode.addEventListener('change',()=>{setFieldDisabled(field); if(input.disabled) input.value='';});
      row.append(mode,input);wrapper.append(row);
      appendHelp(wrapper,u,p.description||(exists?'已保存凭据。未修改则保留原值。':'没有已保存的凭据。'));
      const field={wrapper,input,mode,key:u.key,secret:true,required:isRequired,active:true};
      fields.set('secret:'+u.key,field);
    } else {
      const key=unescapePointer(u.path.slice(1)), p=model.form.schema.properties[key];
      const isRequired=required||(model.form.schema.required||[]).includes(key);
      wrapper.append(element('label',{for:id},(p.title||key)+(isRequired?' *':'')));
      let input;
      if(u.widget==='select') {
        input=element('select',{id}); if(!required)input.append(element('option',{value:''},'请选择'));
        p.enum.forEach((v,i)=>input.append(element('option',{value:String(i)},String(v))));
        const found=p.enum.findIndex(v=>JSON.stringify(v)===JSON.stringify(model.values[key]));
        input.value=found<0?'':String(found);
      } else if(u.widget==='textarea') {input=element('textarea',{id,rows:'3'});input.value=model.values[key]??'';}
      else {
        input=element('input',{id,type:u.widget==='checkbox'?'checkbox':u.widget==='number'?'number':u.widget==='email'?'email':u.widget==='url'?'url':'text'});
        if(p.type==='boolean') input.checked=Boolean(model.values[key]); else input.value=model.values[key]??'';
      }
      if(isRequired && p.type!=='boolean')input.required=true;
      // Unicode length is validated by the server as code points, not UTF-16 units.
      if(p.minimum!==undefined)input.min=p.minimum;
      if(p.maximum!==undefined)input.max=p.maximum;
      if(u.widget==='number')input.step=p.type==='integer'?'1':'any';
      wrapper.append(input);appendHelp(wrapper,u,p.description);
      fields.set(key,{wrapper,input,key,prop:p,widget:u.widget,required:isRequired,active:true});
    }
    container.append(wrapper);
    return fields.get(u.kind==='secret'?'secret:'+u.key:unescapePointer(u.path.slice(1)));
  }
  function fieldValue(field) {
    if(field.widget==='select')return field.input.value===''?undefined:field.prop.enum[Number(field.input.value)];
    if(field.widget==='checkbox')return field.input.checked;
    return field.input.value;
  }
  function updateVariant(variant) {
    const selected=fieldValue(variant.discriminator);
    for(const branch of variant.branches) {
      const active=JSON.stringify(branch.value)===JSON.stringify(selected);
      branch.container.classList.toggle('hidden',!active);
      for(const field of branch.fields) {
        field.active=active;
        if(!active&&field.secret)field.input.value='';
        setFieldDisabled(field);
      }
    }
  }
  function renderVariant(control, container) {
    const discriminator=renderControl({kind:'field',path:control.path,widget:control.widget,help:control.help},container);
    for(const [index,value] of discriminator.prop.enum.entries()) {
      const branch=control.cases.find(item=>JSON.stringify(item.value)===JSON.stringify(value));
      if(branch)discriminator.input.options[index].textContent=branch.label;
    }
    const variant={discriminator,branches:[]};
    for(const branch of control.cases) {
      const branchContainer=element('div',{class:'variant-branch'}), required=new Set(branch.required);
      const branchFields=branch.controls.map(child=>renderControl(child,branchContainer,required.has(child.kind==='field'?'/values'+child.path:'/secrets/'+escapePointer(child.key))));
      container.append(branchContainer);variant.branches.push({value:branch.value,container:branchContainer,fields:branchFields});
    }
    discriminator.input.addEventListener('change',()=>updateVariant(variant));
    variants.push(variant);updateVariant(variant);
  }
  function collect() {
    const values=Object.create(null), secretUpdates=Object.create(null);
    for(const f of fields.values()) {
      if(f.active===false)continue;
      if(f.secret) {secretUpdates[f.key]=f.mode.value==='replace'?{operation:'replace',value:f.input.value}:{operation:f.mode.value};continue;}
      if(f.widget==='checkbox') values[f.key]=f.input.checked;
      else if(f.widget==='select') {if(f.input.value!=='')values[f.key]=f.prop.enum[Number(f.input.value)];}
      else if(f.prop.type==='integer'||f.prop.type==='number') {if(f.input.value!=='')values[f.key]=Number(f.input.value);}
      else if(f.input.value!=='' || f.required) values[f.key]=f.input.value;
    }
    return {values,secretUpdates};
  }
  function finish(result) {
    $('editor').classList.add('hidden');$('result').classList.remove('hidden');
    const saved=result.persistence==='saved';
    $('result-icon').textContent=saved?'✓':'–';
    $('result-title').textContent=saved?'配置已保存':'已取消配置';
    $('result-text').textContent=saved
      ? result.verification==='succeeded'?`连接验证成功，JSON 文件已写入。${result.verificationMessage?' '+result.verificationMessage:''}`:'JSON 文件已写入。本次未执行外部服务连接验证。'
      :'本次会话没有修改配置文件。';
    $('result-path').textContent=result.path;
    if (result.warnings?.length) $('result-text').textContent += ' ' + result.warnings.join(' ');
    for(const f of fields.values())if(f.secret)f.input.value='';
    if(saved&&model.closeAfterMs>0){
      const status=$('close-status'),started=Date.now(),update=()=>{
        const left=Math.max(0,Math.ceil((model.closeAfterMs-(Date.now()-started))/1000));
        status.textContent=left>0?`配置已完成，${left} 秒后尝试关闭此页面。`:'正在尝试关闭页面；若浏览器阻止关闭，可以安全地手动关闭。';
      };
      update();const countdown=setInterval(update,250);
      setTimeout(()=>{clearInterval(countdown);update();window.close();},model.closeAfterMs);
    }
  }
  $('form').addEventListener('submit',async e=>{
    e.preventDefault();if(busy||!model)return;clearErrors();const payload=collect();setBusy(true);
    try{finish(await api('/api/save',payload));}catch(err){showError(err);setBusy(false);}
    finally{for(const u of Object.values(payload.secretUpdates))if('value'in u)u.value='';}
  });
  $('verify').addEventListener('click',async()=>{
    if(busy||!model)return;clearErrors();const payload=collect();setBusy(true,'verify');
    const status=$('verification-status');status.classList.remove('hidden');status.textContent='正在使用当前表单内容连接真实服务…';
    try{const result=await api('/api/verify',payload);status.textContent='✓ '+(result.message||'连接验证成功');}
    catch(err){status.classList.add('hidden');showError(err);}
    finally{setBusy(false);for(const u of Object.values(payload.secretUpdates))if('value'in u)u.value='';}
  });
  $('cancel').addEventListener('click',async()=>{
    if(busy||!model)return;clearErrors();setBusy(true);
    try{finish(await api('/api/cancel',{}));}catch(err){showError(err);setBusy(false);}
  });
  (async()=>{
    try {
      if(!token)throw new Error('缺少会话凭证，请使用终端输出的完整本地链接。');
      model=await api('/api/session');
      document.title=model.plugin.title+' · 配置引导工具';
      $('title').textContent=model.plugin.title;
      $('subtitle').textContent='填写下方配置，保存后供插件后续自动读取。';
      if(model.configurationExists)$('subtitle').textContent='已读取当前设备上的已有配置；修改后将只更新本向导管理的字段。';
      $('target').textContent=model.targetPath;
      $('save').textContent=model.submitLabel;
      if(model.plaintextSecrets)$('secret-notice').classList.remove('hidden');
      if(model.verification.enabled)$('verify').classList.remove('hidden');
      for(const control of model.form.ui) {
        if(control.kind==='variant')renderVariant(control,$('fields'));
        else renderControl(control,$('fields'));
      }
    }catch(err){$('title').textContent='无法打开配置';showError(err);$('save').disabled=true;$('cancel').disabled=true;}
  })();
})();
