import { Injectable, BadRequestException, Logger } from '@nestjs/common';

@Injectable()
export class CoreIntegrationService {
  private readonly logger = new Logger(CoreIntegrationService.name);

  async processCoreIntegration(
    policy: any,
    calculation: any,
    effectiveDate: string,
  ): Promise<{ cnrecibo: string; crecibo: number } | void> {
    const pendingReceipts = (policy.recibos ?? [])
      .filter((r: any) => r.Status_Rec === 'Pendiente')
      .map((r: any) => r.cnrecibo?.trim() || r.crecibo?.toString());

    const CORE_API_BASE_URL =
      process.env.CORE_API_URL ??
      (process.env.NODE_ENV === 'development'
        ? 'http://localhost:5254'
        : 'https://qaapisys2000.lamundialdeseguros.com');

    // 1. Anular recibos pendientes si existen
    if (pendingReceipts.length > 0) {
      this.logger.log(
        `Voiding pending receipts in Core: ${pendingReceipts.join(', ')}`,
      );
      const anularRes = await fetch(
        `${CORE_API_BASE_URL}/api/v1/changes/anularRecibos`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cnpoliza: policy.cnpoliza || policy.policyId,
            recibos: pendingReceipts,
            fanulacion: effectiveDate,
            cusuario: 7,
          }),
        },
      );

      if (!anularRes.ok) {
        const errText = await anularRes.text();
        throw new BadRequestException(
          `Fallo al anular recibos en el Core: ${errText}`,
        );
      }
    }

    let fanopoliza = policy.fanopoliza;
    let fmespoliza = policy.fmespoliza;
    if ((!fanopoliza || !fmespoliza) && policy.policyId.includes('-')) {
      const parts = policy.policyId.split('-');
      if (parts.length === 3) {
        fanopoliza = parseInt(parts[1], 10);
        fmespoliza = parseInt(parts[2], 10);
      }
    }

    // 2. Crear el nuevo recibo con la prima calculada
    this.logger.log(
      `Creating new receipt in Core for premium: ${calculation.targetPremium}`,
    );
    const crearRes = await fetch(
      `${CORE_API_BASE_URL}/api/v1/endoso-recibos/crearRecibo`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cnpoliza: policy.cnpoliza || policy.policyId,
          fanopoliza,
          fmespoliza,
          mprima: calculation.targetPremium,
          fdesde: effectiveDate,
          fhasta: policy.endDate,
          cusuario: 7,
          cplan: calculation.targetPlan,
        }),
      },
    );

    if (!crearRes.ok) {
      const errText = await crearRes.text();
      throw new BadRequestException(
        `Fallo al crear el recibo en el Core: ${errText}`,
      );
    }

    try {
      const data = await crearRes.json();
      if (data && data.success && data.cnrecibo && data.crecibo) {
        return {
          cnrecibo: data.cnrecibo.trim(),
          crecibo: data.crecibo,
        };
      }
    } catch (e: any) {
      this.logger.warn(
        `Could not parse JSON response from Core receipt creation: ${e.message}`,
      );
    }
  }

  async reportPayment(payload: {
    cnrecibo: string;
    totalCharge: number;
    reference: string;
  }): Promise<boolean> {
    const { cnrecibo, totalCharge, reference } = payload;
    const CORE_API_BASE_URL =
      process.env.CORE_API_URL ?? 'https://qaapisys2000.lamundialdeseguros.com';
    const CORE_API_KEY =
      process.env.CORE_API_KEY ??
      '46fce2c9f33e09ed3404fca58592d3000d20d419dabb7cd456e958818ff07de9';

    this.logger.log(
      `Reporting payment of receipt ${cnrecibo} to Core collection API...`,
    );

    try {
      const response = await fetch(
        `${CORE_API_BASE_URL}/api/v1/collection-automatic/collect`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': CORE_API_KEY,
          },
          body: JSON.stringify({
            cnrecibo: cnrecibo,
            mpago: totalCharge,
            xreferencia: reference,
            fpago: new Date().toISOString().split('T')[0],
          }),
        },
      );

      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(
          `Core collection API returned error status ${response.status}: ${errText}`,
        );
        return false;
      }
      
      this.logger.log(`Payment reported successfully to Core for receipt ${cnrecibo}`);
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to call Core collection API: ${err.message}`);
      return false;
    }
  }
}
