"use client";

import { useAuth } from "@/components/AuthProvider";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CaseDecisionClient({ id, initialData }: { id: string, initialData: any }) {
    const { role } = useAuth();
    const router = useRouter();

    const [decision, setDecision] = useState<"approve" | "reject" | "request_evidence">("approve");
    const [note, setNote] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isReadOnly = role === "analyst";
    const status = initialData.decisionStatus; // "open" | "resolved"
    const latestDecision = initialData.latestDecision;

    const handleSubmit = async () => {
        if ((decision === "reject" || decision === "request_evidence") && note.length < 5) {
            alert("Para recusar ou pedir evidência, anexe um detalhamento (mín: 5 caracteres).");
            return;
        }

        try {
            setIsSubmitting(true);
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/cases/${id}/decision`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ decision, note })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Falha ao enviar decisão");
            }

            alert("Decisão gravada com sucesso!");
            router.push("/app/cases");
            router.refresh();
        } catch (error: any) {
            alert(error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (status === "resolved" && latestDecision) {
        return (
            <div className="bg-white rounded-xl border border-emerald-200 shadow-sm overflow-hidden">
                <div className="flex flex-col space-y-1.5 p-6 border-b bg-emerald-50/50">
                    <h3 className="font-semibold leading-none tracking-tight text-lg text-emerald-800">Caso Resolvido</h3>
                    <p className="text-sm text-gray-500">Decisão tomada em {new Date(latestDecision.decidedAt).toLocaleString("pt-BR")}</p>
                </div>
                <div className="p-6 pt-6 space-y-4">
                    <div className="grid gap-2 text-sm">
                        <div className="font-medium text-gray-500">Veredito:</div>
                        <div className="font-semibold text-gray-900 uppercase">
                            {latestDecision.decision === "approve" ? "Aprovado" : latestDecision.decision === "reject" ? "Negado (Fraude)" : "Evidência Solicitada"}
                        </div>
                    </div>
                    <div className="grid gap-2 text-sm">
                        <div className="font-medium text-gray-500">Justificativa do Operador:</div>
                        <div className="p-3 bg-gray-50 rounded italic text-gray-700">
                            {latestDecision.note || "Sem nota registrada."}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-indigo-100 shadow-xl shadow-indigo-100/50 overflow-hidden sticky top-6">
            <div className="flex flex-col space-y-1.5 p-6 border-b bg-indigo-50/50 border-indigo-50">
                <h3 className="font-semibold leading-none tracking-tight text-lg text-indigo-900">Decisão Operacional</h3>
                <p className="text-sm text-gray-500">
                    {isReadOnly
                        ? "O seu perfil (Analyst) possui apenas permissão de leitura sobre esse caso."
                        : "Analise os riscos apontados pela Inteligência Artificial e tome uma ação definitiva para este caso."}
                </p>
            </div>
            <div className="p-6 pt-6 space-y-8">
                <div
                    role="radiogroup"
                    className="grid gap-2"
                >
                    <label className={`flex items-start space-x-3 p-3 rounded border transition-colors cursor-pointer ${decision === "approve" ? "bg-emerald-50 border-emerald-200" : "bg-white hover:bg-slate-50"} ${isReadOnly || isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}>
                        <input type="radio" name="decision" value="approve" checked={decision === "approve"} disabled={isReadOnly || isSubmitting} onChange={(e) => setDecision("approve")} className="mt-1" />
                        <div className="font-medium">
                            <span className="text-emerald-700 font-bold block mb-1">Aprovar Devolução</span>
                            <span className="text-gray-500 text-xs font-normal">O extorno seguirá o processo normal sem suspeitas fundadas.</span>
                        </div>
                    </label>
                    <label className={`flex items-start space-x-3 p-3 rounded border transition-colors cursor-pointer ${decision === "reject" ? "bg-red-50 border-red-200" : "bg-white hover:bg-slate-50"} ${isReadOnly || isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}>
                        <input type="radio" name="decision" value="reject" checked={decision === "reject"} disabled={isReadOnly || isSubmitting} onChange={(e) => setDecision("reject")} className="mt-1" />
                        <div className="font-medium">
                            <span className="text-red-700 font-bold block mb-1">Negar (Risco de Fraude)</span>
                            <span className="text-gray-500 text-xs font-normal">Ação bloqueadora por suspeita de fraude baseada no Score e motivos da IA.</span>
                        </div>
                    </label>
                    <label className={`flex items-start space-x-3 p-3 rounded border transition-colors cursor-pointer ${decision === "request_evidence" ? "bg-amber-50 border-amber-200" : "bg-white hover:bg-slate-50"} ${isReadOnly || isSubmitting ? "opacity-50 cursor-not-allowed" : ""}`}>
                        <input type="radio" name="decision" value="request_evidence" checked={decision === "request_evidence"} disabled={isReadOnly || isSubmitting} onChange={(e) => setDecision("request_evidence")} className="mt-1" />
                        <div className="font-medium">
                            <span className="text-amber-700 font-bold block mb-1">Pedir Evidência</span>
                            <span className="text-gray-500 text-xs font-normal">Sinaliza alerta amarelo e pausa a análise exigindo fotos ou informações do cliente.</span>
                        </div>
                    </label>
                </div>

                <div className="space-y-3">
                    <label htmlFor="note" className="text-sm font-medium leading-none text-gray-700">
                        Anotações da Decisão {decision !== "approve" && <span className="text-red-500">*</span>}
                    </label>
                    <textarea
                        id="note"
                        placeholder="Para negar ou pausar, relate obrigatoriamente a razão identificada..."
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        disabled={isReadOnly || isSubmitting}
                        className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                    <p className="text-[11px] text-gray-400">
                        Esta nota será gravada publicamente na trilha de auditoria do Tenant atrelada ao seu usuário.
                    </p>
                </div>

                {!isReadOnly && (
                    <button
                        className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-11 px-8 w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                        disabled={isSubmitting}
                        onClick={handleSubmit}
                    >
                        {isSubmitting ? "Protegendo registro..." : "Gravar Decisão (Auditoria Ativa)"}
                    </button>
                )}
            </div>
        </div>
    );
}
