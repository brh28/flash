import { GT } from "@graphql/index"

import IPrice from "../abstract/price"
import SafeInt from "../scalar/safe-int"

const PriceOfOneSat = GT.Object({
  name: "PriceOfOneSat",
  interfaces: () => [IPrice],
  description: "Price of 1 sat in base/offset. To calculate, use: `base / 10^offset`",
  fields: () => ({
    base: { type: GT.NonNull(SafeInt) },
    offset: { type: GT.NonNull(GT.Int) },
    currencyUnit: { type: GT.NonNull(GT.String) },
  }),
})

export default PriceOfOneSat
