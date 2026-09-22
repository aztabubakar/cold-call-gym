insert into public.scenarios(slug,name,description,difficulty,objective,prospect_role,prospect_company,persona,hidden_state,target_duration_seconds)
values
('busy-vp','Busy VP of Sales','Earn attention from an impatient executive.','realistic','Secure permission for a deeper conversation.','VP of Sales','Northstar Software',
  '{"name":"Jordan Blake","patience":"low","skepticism":"high","common_objections":["I have two minutes. What is this about?","We are not looking right now."]}',
  '{"pain_point":"forecast visibility","opening_objection":"I have two minutes. What is this about?"}',180),
('send-email','Send me an email','Recover from the classic brush-off.','practice','Earn one discovery question or follow-up.','Director of Operations','Lumen Logistics',
  '{"name":"Priya Nathan","patience":"medium","skepticism":"medium","common_objections":["Can you just email me something?","I do not take cold calls."]}',
  '{"pain_point":"manual reporting","opening_objection":"Can you just email me something?"}',300),
('not-interested','Not interested','Handle early resistance naturally.','realistic','Turn a reflexive no into thirty more seconds of attention.','Marketing Manager','Fieldstone Retail',
  '{"name":"Dana Ruiz","patience":"low","skepticism":"medium","common_objections":["We are not interested.","We already tried something like this."]}',
  '{"pain_point":"campaign attribution","opening_objection":"We are not interested."}',240),
('competitor','We already use a competitor','Differentiate without attacking the incumbent.','challenge','Uncover one unmet need.','Head of Revenue Operations','Atlas Cloud',
  '{"name":"Marcus Webb","patience":"medium","skepticism":"high","common_objections":["We already have a platform for that.","Switching costs are not worth it."]}',
  '{"pain_point":"adoption","opening_objection":"We already have a platform for that."}',360),
('gatekeeper','Gatekeeper','Reach the right person professionally.','challenge','Get transferred to or scheduled with the decision maker.','Executive Assistant','Harbor Financial',
  '{"name":"Casey Lin","patience":"medium","skepticism":"high","common_objections":["She is not available.","What is this regarding, exactly?"]}',
  '{"pain_point":"screening volume","opening_objection":"What is this regarding?"}',150),
('price-objection','Price objection','Defend value without discounting on reflex.','challenge','Reframe the conversation around ROI, not cost.','Finance Director','Ridgeline Manufacturing',
  '{"name":"Alicia Ferro","patience":"medium","skepticism":"high","common_objections":["That is way more than we budgeted.","Send me a discount and I will consider it."]}',
  '{"pain_point":"budget approval","opening_objection":"That is more than we budgeted for."}',300)
on conflict(slug) do update set
  description=excluded.description,
  difficulty=excluded.difficulty,
  objective=excluded.objective,
  prospect_role=excluded.prospect_role,
  prospect_company=excluded.prospect_company,
  persona=excluded.persona,
  hidden_state=excluded.hidden_state,
  target_duration_seconds=excluded.target_duration_seconds;
