# Configuração do Cloudinary

Para usar o upload de imagens, você precisa configurar as variáveis de ambiente do Cloudinary.

## Passos:

1. Crie uma conta no [Cloudinary](https://cloudinary.com/)
2. Acesse o Dashboard e copie suas credenciais:
   - Cloud Name
   - API Key
   - API Secret

3. Adicione as seguintes variáveis ao seu arquivo `.env`:

```env
CLOUDINARY_CLOUD_NAME=seu_cloud_name
CLOUDINARY_API_KEY=sua_api_key
CLOUDINARY_API_SECRET=sua_api_secret
```

## Estrutura de Pastas no Cloudinary:

- `avatars/{userId}/` - Fotos de perfil dos usuários
- `company-logos/{companyId}/` - Logos de empresas (futuro)

## Limites:

- Tamanho máximo de arquivo: 2MB
- Formatos aceitos: JPG, PNG, GIF, WebP
- Transformações automáticas: Redimensionamento para 512x512px mantendo proporção
