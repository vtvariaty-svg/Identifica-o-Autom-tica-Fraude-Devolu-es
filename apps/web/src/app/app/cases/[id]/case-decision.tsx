"use client";

import { useAuth } from "@/components/AuthProvider";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "react-hot-toast";

export default function CaseDecisionClient({ id, initialData }: { id: string, initialData: any }) {
    const { token, role } = useAuth();
    const router = useRouter();

    const [decision, setDecision] = useState<"approve" | "reject" | "request_evidence">("approve");
    const [note, setNote] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const isReadOnly = role === "analyst";
    const status = initialData.decisionStatus; // "open" | "resolved"
    const latestDecision = initialData.latestDecision;

    const handleSubmit = async () => {
        if (!token) return;

        if ((decision === "reject" || decision === "request_evidence") && note.length < 5) {
            toast.error("Para recusar ou pedir evidência, anexe um detalhamento (mín: 5 caracteres).");
            return;
        }

        try {
            setIsSubmitting(true);
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/cases/${id}/decision`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({ decision, note })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Falha ao enviar decisão");
            }

            toast.success("Decisão gravada com sucesso!");
            router.push("/app/cases");
            router.refresh();
        } catch (error: any) {
            toast.error(error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (status === "resolved" && latestDecision) {
        return (
            <Card className="border-emerald-200">
                <CardHeader className="bg-emerald-50/50">
                    <CardTitle className="text-emerald-800">Caso Resolvido</CardTitle>
                    <CardDescription>Decisão tomada em {new Date(latestDecision.decidedAt).toLocaleString("pt-BR")}</CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
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
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="border-indigo-100 shadow-xl shadow-indigo-100/50 sticky top-6">
            <CardHeader className="bg-indigo-50/50 border-b border-indigo-50">
                <CardTitle className="text-indigo-900">Decisão Operacional</CardTitle>
                <CardDescription>
                    {isReadOnly
                        ? "O seu perfil (Analyst) possui apenas permissão de leitura sobre esse caso."
                        : "Analise os riscos apontados pela Inteligência Artificial e tome uma ação definitiva para este caso."}
                </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-8">
                <RadioGroup
                    value={decision}
                    onValueChange={(v: "approve" | "reject" | "request_evidence") => setDecision(v)}
                    disabled={isReadOnly || isSubmitting}
                >
                    <div className="flex items-center space-x-3 p-3 rounded border bg-emerald-50/30 hover:bg-emerald-50/50 transition-colors">
                        <RadioGroupItem value="approve" id="r-approve" />
                        <Label htmlFor="r-approve" className="font-medium cursor-pointer">
                            <span className="text-emerald-700 font-bold block mb-1">Aprovar Devolução</span>
                            <span className="text-gray-500 text-xs font-normal">O extorno seguirá o processo normal sem suspeitas fundadas.</span>
                        </Label>
                    </div>
                    <div className="flex items-center space-x-3 p-3 rounded border bg-red-50/30 hover:bg-red-50/50 transition-colors">
                        <RadioGroupItem value="reject" id="r-reject" />
                        <Label htmlFor="r-reject" className="font-medium cursor-pointer">
                            <span className="text-red-700 font-bold block mb-1">Negar (Risco de Fraude)</span>
                            <span className="text-gray-500 text-xs font-normal">Ação bloqueadora por suspeita de fraude baseada no Score e motivos da IA.</span>
                        </Label>
                    </div>
                    <div className="flex items-center space-x-3 p-3 rounded border bg-amber-50/30 hover:bg-amber-50/50 transition-colors">
                        <RadioGroupItem value="request_evidence" id="r-evidence" />
                        <Label htmlFor="r-evidence" className="font-medium cursor-pointer">
                            <span className="text-amber-700 font-bold block mb-1">Pedir Evidência</span>
                            <span className="text-gray-500 text-xs font-normal">Sinaliza alerta amarelo e pausa a análise exigindo fotos ou informações do cliente.</span>
                        </Label>
                    </div>
                </RadioGroup>

                <div className="space-y-3">
                    <Label htmlFor="note" className="text-gray-700 font-semibold">
                        Anotações da Decisão {decision !== "approve" && <span className="text-red-500">*</span>}
                    </Label>
                    <Textarea
                        id="note"
                        placeholder="Para negar ou pausar, relate obrigatoriamente a razão identificada..."
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        disabled={isReadOnly || isSubmitting}
                        className="min-h-[120px]"
                    />
                    <p className="text-[11px] text-gray-400">
                        Esta nota será gravada publicamente na trilha de auditoria do Tenant atrelada ao seu usuário.
                    </p>
                </div>

                {!isReadOnly && (
                    <Button
                        size="lg"
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                        disabled={isSubmitting}
                        onClick={handleSubmit}
                    >
                        {isSubmitting ? "Protegendo registro..." : "Gravar Decisão (Auditoria Ativa)"}
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}
