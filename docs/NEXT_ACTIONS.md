# NEXT ACTIONS — CRM-AI Stabilization

## Context

Current scale:
- Active WhatsApp numbers: 2
- Average inbound chats: 100+ per number per day
- Dashboard users: 3 CS/admin
- Target: internal CRM for company operations
- Most important function: AI auto-reply that is contextual and helps closing

## P0 — Stop The Bleeding

- [x] Create stabilization branch
- [x] Add audit and architecture docs
- [x] Remove backups/logs/binary files from tracking
- [ ] Rotate OpenAI API key
- [ ] Rotate Groq API keys
- [ ] Disable automatic follow-up scheduler
- [ ] Confirm .env is ignored
- [ ] Confirm database/backups/logs are ignored
- [ ] Change admin default password
- [ ] Move SESSION_SECRET fully to env
- [ ] Restrict Socket.IO CORS
- [ ] Add opt-out detection
- [ ] Add human takeover rule

## P1 — Make AI Actually Useful

- [ ] Review current system prompt
- [ ] Separate prompt into system_prompt, product_knowledge, behavior_rules, conversation_examples
- [ ] Add anti-spam response rules
- [ ] Add closing-oriented CS examples
- [ ] Add test dataset for common customer questions
- [ ] Add AI evaluation checklist

## P2 — CRM Value

- [ ] Daily lead summary
- [ ] Hot lead labels
- [ ] Customer status pipeline
- [ ] Order summary
- [ ] Manual follow-up queue
- [ ] CS performance dashboard

## P3 — Official WhatsApp Migration

- [ ] Decide: Cloud API direct or BSP
- [ ] Prepare Meta Business verification
- [ ] Prepare message template list
- [ ] Build channel adapter interface
- [ ] Implement Cloud API adapter
- [ ] Run hybrid migration