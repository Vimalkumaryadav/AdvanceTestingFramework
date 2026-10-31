/**
 * UI texts exactly as observed on the live site (docs/discovery/02-ui-map.md).
 * Only verified strings belong here.
 */
export const Messages = {
  generic: {
    internalError: 'An internal error has occurred and has been logged.',
    errorHeading: 'Error!',
  },
  login: {
    invalidCredentials: 'The username and password could not be verified.',
    missingCredentials: 'Please enter a username and password.',
  },
  register: {
    heading: 'Signing up is easy!',
    successTitle: 'ParaBank | Customer Created',
    success: 'Your account was created successfully. You are now logged in.',
    welcomeHeading: (username: string) => `Welcome ${username}`,
    duplicateUsername: 'This username already exists.',
    passwordMismatch: 'Passwords did not match.',
    required: {
      'customer.firstName': 'First name is required.',
      'customer.lastName': 'Last name is required.',
      'customer.address.street': 'Address is required.',
      'customer.address.city': 'City is required.',
      'customer.address.state': 'State is required.',
      'customer.address.zipCode': 'Zip Code is required.',
      'customer.ssn': 'Social Security Number is required.',
      'customer.username': 'Username is required.',
      'customer.password': 'Password is required.',
      repeatedPassword: 'Password confirmation is required.',
    },
  },
  lookup: {
    success: 'Your login information was located successfully. You are now logged in.',
    notFound: 'The customer information provided could not be found.',
    required: {
      firstName: 'First name is required.',
      lastName: 'Last name is required.',
      'address.street': 'Address is required.',
      'address.city': 'City is required.',
      'address.state': 'State is required.',
      'address.zipCode': 'Zip Code is required.',
      ssn: 'Social Security Number is required.',
    },
  },
  contact: {
    thanks: (name: string) => `Thank you ${name}`,
    followUp: 'A Customer Care Representative will be contacting you.',
    required: {
      name: 'Name is required.',
      email: 'Email is required.',
      phone: 'Phone is required.',
      message: 'Message is required.',
    },
  },
  overview: {
    footnote: '*Balance includes deposits that may be subject to holds',
  },
  activity: {
    noTransactions: 'No transactions found.',
  },
  openAccount: {
    heading: 'Account Opened!',
    success: 'Congratulations, your account is now open.',
  },
  transfer: {
    heading: 'Transfer Complete!',
    /** "$25.00 has been transferred from account #1 to account #2." */
    success: (amount: string, from: number | string, to: number | string) =>
      `${amount} has been transferred from account #${from} to account #${to}.`,
  },
  billPay: {
    heading: 'Bill Payment Complete',
    success: (payee: string, amount: string, from: number | string) =>
      `Bill Payment to ${payee} in the amount of ${amount} from account ${from} was successful.`,
    errors: {
      name: 'Payee name is required.',
      address: 'Address is required.',
      city: 'City is required.',
      state: 'State is required.',
      zipCode: 'Zip Code is required.',
      phoneNumber: 'Phone number is required.',
      accountEmpty: 'Account number is required.',
      accountInvalid: 'Please enter a valid number.',
      verifyAccountEmpty: 'Account number is required.',
      verifyAccountInvalid: 'Please enter a valid number.',
      verifyAccountMismatch: 'The account numbers do not match.',
      amountEmpty: 'The amount cannot be empty.',
      amountInvalid: 'Please enter a valid amount.',
    },
  },
  findTransactions: {
    resultsHeading: 'Transaction Results',
    invalidId: 'Invalid transaction ID',
    invalidDate: 'Invalid date format',
    invalidAmount: 'Invalid amount',
  },
  updateProfile: {
    heading: 'Profile Updated',
    success: 'Your updated address and phone number have been added to the system.',
    required: {
      firstName: 'First name is required.',
      lastName: 'Last name is required.',
      street: 'Address is required.',
      city: 'City is required.',
      state: 'State is required.',
      zipCode: 'Zip Code is required.',
    },
  },
  loan: {
    heading: 'Loan Request Processed',
    approved: 'Congratulations, your loan has been approved.',
    status: { approved: 'Approved', denied: 'Denied' },
    denied: {
      insufficientFundsForDownPayment:
        'You do not have sufficient funds for the given down payment.',
      insufficientFunds: 'We cannot grant a loan in that amount with your available funds.',
    },
  },
} as const;
