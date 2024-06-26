import { GT } from "@graphql/index"
import LnPaymentRequest from "@graphql/shared/types/scalar/ln-payment-request"

const LnInvoicePaymentStatusInput = GT.Input({
  name: "LnInvoicePaymentStatusInput",
  fields: () => ({
    paymentRequest: { type: GT.NonNull(LnPaymentRequest) },
  }),
})

export default LnInvoicePaymentStatusInput
