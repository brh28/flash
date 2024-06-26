import { GT } from "@graphql/index"

import { Authentication } from "@app"
import { mapAndParseErrorForGqlResponse } from "@graphql/error-map"
import AuthToken from "@graphql/shared/types/scalar/auth-token"
import UserTotpRegistrationInitiatePayload from "@graphql/public/types/payload/user-totp-registration-initiate"

const UserTotpRegistrationInitiateInput = GT.Input({
  name: "UserTotpRegistrationInitiateInput",
  fields: () => ({
    authToken: {
      type: GT.NonNull(AuthToken),
    },
  }),
})

const UserTotpRegistrationInitiateMutation = GT.Field<
  null,
  GraphQLPublicContextAuth,
  {
    input: {
      authToken: AuthToken | InputValidationError
    }
  }
>({
  extensions: {
    complexity: 120,
  },
  type: GT.NonNull(UserTotpRegistrationInitiatePayload),
  args: {
    input: { type: GT.NonNull(UserTotpRegistrationInitiateInput) },
  },
  resolve: async (_, args) => {
    const { authToken } = args.input

    if (authToken instanceof Error) {
      return { errors: [{ message: authToken.message }] }
    }

    const res = await Authentication.initiateTotpRegistration({
      authToken,
    })

    if (res instanceof Error) {
      return { errors: [mapAndParseErrorForGqlResponse(res)], success: false }
    }

    const { totpSecret, totpRegistrationId } = res

    return { errors: [], totpRegistrationId, totpSecret }
  },
})

export default UserTotpRegistrationInitiateMutation
