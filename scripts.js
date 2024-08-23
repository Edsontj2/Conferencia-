// Array de produtos com código e descrição
const produtos = [
    { codigo: '001', descricao: 'Produto A' },
    { codigo: '002', descricao: 'Produto B' },
    { codigo: '003', descricao: 'Produto C' },
    { codigo: '004', descricao: 'Produto D' },
    { codigo: '005', descricao: 'Produto E' }
];

// Função para renderizar a lista de produtos
function renderizarProdutos() {
    const lista = document.getElementById('product-list');
    produtos.forEach(produto => {
        const item = document.createElement('li');
        item.classList.add('product-item');
        item.innerHTML = `
            <span class="codigo">${produto.codigo}</span>
            <span class="descricao">${produto.descricao}</span>
            <button class="scan-btn" onclick="abrirCamera('${produto.codigo}')">Escanear</button>
        `;
        lista.appendChild(item);
    });
}

// Função para abrir a câmera e escanear código de barras
function abrirCamera(codigoProduto) {
    const cameraContainer = document.getElementById('camera-container');
    const video = document.getElementById('camera-stream');

    // Verifica se o navegador suporta a API de Media Devices
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ video: true })
            .then(stream => {
                video.srcObject = stream;
                cameraContainer.style.display = 'block';

                // Aqui você pode adicionar a lógica para ler o código de barras usando uma biblioteca
                console.log(`Câmera aberta para o produto com código: ${codigoProduto}`);
            })
            .catch(error => {
                console.error("Erro ao acessar a câmera: ", error);
            });
    } else {
        alert("Câmera não suportada neste dispositivo/navegador.");
    }
}

// Renderizar produtos na tela ao carregar a página
document.addEventListener('DOMContentLoaded', renderizarProdutos);
