import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DraftEditor from "../components/DraftEditor";
import { isOpportunityArchived, lifecycleMatches } from "../../supabase/functions/_shared/opportunityLifecycle";

describe("reconciled owner release protections", () => {
  it("keeps legacy archive status out of the active scope without fabricating metadata", () => {
    expect(isOpportunityArchived({status:"archived",archived_at:null})).toBe(true);
    expect(lifecycleMatches(null,"active","archived")).toBe(false);
    expect(lifecycleMatches(null,"archived","archived")).toBe(true);
    expect(isOpportunityArchived({pipeline_status:"archived"})).toBe(true);
  });
  it.each(["sending","uncertain"] as const)("preserves the %s barrier after page reload",state=>{
    const html=renderToStaticMarkup(<DraftEditor draft={{id:"fixture",subject:"Recorded subject",body:"Recorded body",status:"approved",created_at:"2026-10-21",approved_at:null,sent_at:null,send_state:state}} saving={false} approving={false} sending={false} sendFailed={false} error={null} onSave={async()=>{}} onApprove={()=>{}} onSend={async()=>{}} />);
    expect(html).toContain("Do not resend");
    expect(html).not.toContain("Approved and ready to send");
    expect(html.match(/<button[^>]+disabled=""/g)?.length).toBe(3);
    expect(html.match(/<(?:input|textarea)[^>]+disabled=""/g)?.length).toBe(2);
  });
  it("keeps SMTP DATA acceptance successful if QUIT disconnects",async()=>{
    const source=ts.createSourceFile("api.ts",readFileSync("supabase/functions/opportunities/index.ts","utf8"),ts.ScriptTarget.Latest,true);
    const node=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="sendSmtpEmail")!;
    const code=ts.transpileModule(node.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    const conn={close:vi.fn()};
    const command=vi.fn(async(_c:unknown,text:string)=>{if(text==="QUIT")throw Error("disconnected after acceptance");return "250 OK";});
    const deps={isValidEmailAddress:()=>true,connectSmtp:async()=>conn,smtpCommand:command,EHLO_DOMAIN:"localhost",base64:(x:string)=>x,smtpAddress:(x:string)=>x,buildOutreachMessage:()=>"fixture",dotStuff:(x:string)=>x,writeSmtp:async()=>{},readSmtpResponse:async()=>"250 accepted",smtpStatus:()=>250};
    const send=new Function(...Object.keys(deps),code+";return sendSmtpEmail;")(...Object.values(deps));
    await expect(send({}, {subject:"fixture",text:"fixture",html:"fixture"},"fixture","fixture@example.invalid")).resolves.toBeUndefined();
    expect(conn.close).toHaveBeenCalledOnce();
  });
});
