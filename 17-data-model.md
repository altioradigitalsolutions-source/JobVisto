# Data Model Draft

Modelo inicial para construir el MVP. Puede adaptarse segun el stack final.

## users

- id
- name
- email
- emailVerified
- phone
- avatarUrl
- authProvider
- preferredLanguage
- createdAt
- updatedAt

## organizations

Para empresas y tambien para el espacio del independiente.

- id
- name
- type: independent | company
- ownerUserId
- country
- currency
- timezone
- defaultLanguage
- planId
- status
- createdAt
- updatedAt

## organizationMembers

- id
- organizationId
- userId
- role: owner | manager | cleaner
- status
- invitedAt
- joinedAt

## cleaners

Perfil operativo del cleaner dentro de una organizacion.

- id
- organizationId
- userId optional
- name
- email
- phone
- workerType: employee | freelancer | independent
- hourlyRate
- currency
- language
- city
- status
- notes
- createdAt

## clients

- id
- organizationId
- name
- phone
- email
- preferredLanguage
- notificationChannel
- defaultPaymentMethod
- notes
- internalNotes
- createdAt
- updatedAt

## clientAddresses

- id
- clientId
- label
- addressLine
- city
- country
- latitude optional
- longitude optional
- accessNotes

## jobs

- id
- organizationId
- clientId
- addressId
- assignedCleanerId
- title
- serviceType
- scheduledStart
- scheduledEnd
- pricingType: hourly | fixed
- hourlyRate
- fixedPrice
- currency
- status
- requiresPhotos
- requiresClientSignature
- notifyClient
- cleanerNotes
- internalNotes
- createdAt
- updatedAt

## jobCheckins

- id
- jobId
- cleanerId
- type: check_in | check_out
- timestamp
- latitude optional
- longitude optional
- accuracy optional
- createdAt

## jobTasks

- id
- jobId
- title
- area
- status: pending | done | skipped
- completedAt
- notes

## jobPhotos

- id
- jobId
- uploadedByCleanerId
- category: before | after | evidence | incident
- url
- thumbnailUrl
- caption
- createdAt

## jobIncidents

- id
- jobId
- cleanerId
- type
- description
- photoId optional
- createdAt

## clientSignatures

- id
- jobId
- signerName
- signatureUrl or signatureData
- confirmationText
- signedAt
- signedFrom: cleaner_device | private_link

## privateLinks

- id
- jobId
- token
- expiresAt optional
- viewedAt optional
- createdAt

## estimates

- id
- jobId optional
- organizationId
- cleanerId optional
- periodStart optional
- periodEnd optional
- subtotal
- taxRate
- taxAmount
- discounts
- totalEstimated
- currency
- notes
- createdAt

## paymentReceipts

Solo empresa.

- id
- organizationId
- cleanerId
- periodStart
- periodEnd
- amount
- currency
- paymentMethod
- paidAt
- registeredByUserId
- receiverName
- receiverSignatureUrl or signatureData
- notes
- status: draft | signed | void
- createdAt

## notifications

- id
- organizationId
- recipientType: user | client
- recipientId
- channel: email | whatsapp | sms | push
- templateKey
- status
- payload
- sentAt
- createdAt

## plans

- id
- name
- type
- monthlyPrice
- launchPrice
- includedCleaners
- features
- isActive

## subscriptions

- id
- organizationId
- planId
- status
- startedAt
- trialEndsAt
- currentPeriodStart
- currentPeriodEnd
- provider
- providerSubscriptionId

## settings

Puede ser por organizacion.

- id
- organizationId
- key
- value

