/**
 * Dados reais iniciais, transcritos das escalas em papel.
 * Cada lote é aplicado UMA vez (registrado em schema_migrations) e não duplica cadastros:
 * linhas, carros e pessoas são reaproveitados pelo código/número/nome.
 */
export interface SeedRow {
  carro: string | null; // número de frota; null = não informado na escala
  hora: string;
  linha: string;
  rend: string;
  motorista: string;
  cobrador: string;
}
export interface SeedDay { name: string; date: string; sections: { shift: string; rows: SeedRow[] }[] }

const r = (carro: string | null, hora: string, linha: string, rend: string, motorista: string, cobrador: string): SeedRow =>
  ({ carro, hora, linha, rend, motorista, cobrador });

export const SEED_DAYS: SeedDay[] = [
  {
    name: 'seed_domingo_2026-10-11',
    date: '2026-10-11',
    sections: [
      {
        shift: 'Manhã',
        rows: [
          r('541664', '05:30', '0.783', '11:45', 'FABIO SANTOS', 'CLEANE GONÇALVES'),
          r('541567', '05:30', '782.1', '13:10', 'FLAVIANO SOUSA', 'VANDERLENE MATIAS'),
          r('541478', '05:35', '141.2', '12:50', 'LAURO NETO', 'IVAM GOMES'),
          r('541516', '05:35', '141.9', '12:40', 'CLEINILSO ALVES', 'NIKOLE ELISTIONE'),
          r('541575', '05:40', '141.7', '12:15', 'JAKSON SANTOS', 'RAQUEL SOARES'),
          r('541630', '05:50', '783.1', '12:30', 'RENAN ALVES', 'NAUANY FRANCISCA'),
          r('541486', '06:00', '141.6', '13:30', 'HENRRIQUE GRECCO', 'DANIEL MARRA'),
          r('541141', '06:00', '0.783', '13:20', 'ANDRE LUIZ SALES', 'PAULO OLIVEIRA'),
          r('541401', '06:10', '783.3', '13:56', 'MARCELO MALHEIROS', 'JOELMA PRINCIPE'),
          r('541451', '06:10', '782.1', '13:20', 'JOAO BENEDITO', 'VICTOR HUGO'),
          r('541541', '06:13', '141.6', '13:43', 'LUAN EDUARDO', 'MARLUCIA AMORIM'),
          r('541346', '06:20', '141.8', '13:20', 'JOSE ANDRE VILAR', 'DHENIFER AMORIM'),
          r('541672', '06:20', '783.1', '13:25', 'EMERSON AUGUSTO', 'LUIZ CARLOS'),
          r('541354', '06:20', '141.1', '13:25', 'JORGE MARIANO', 'GENDRY BIENVENUE'),
          r('541559', '06:26', '141.6', '14:00', 'FRANCISCO DE ASSIS', 'SIRLEIANE CANDIDO'),
          r('541435', '06:30', '0.783', '13:05', 'GILMAR DIVINO', 'EILANE ALENCAR'),
          r('541605', '06:35', '0.782', '13:15', 'JONAS VALVERDE', 'CLEIDE ANGELA'),
          r('541648', '06:39', '141.6', '14:09', 'VALDECI GOMES', 'ESTER EVANGELISTA'),
          r('541460', '06:40', '783.2', '13:35', 'MARCO AURELIO', 'ANA LUCIA'),
          r('541443', '06:40', '141.9', '14:05', 'JOSE RODRIGUES', 'CIMAYRIA SILVA'),
          r('541419', '06:52', '141.6', '14:22', 'ROBSON PACHECO', 'KAMILA TEXEIRA'),
          r('541656', '07:00', '0.783', '14:30', 'EDENILSO DA CRUZ', 'MIRANILDE ALENCAR'),
          r('541389', '07:35', '141.5', '14:25', 'CARLOS GRACIANO', 'ROBERT HENRRIQUE'),
        ],
      },
      {
        shift: 'Tarde',
        rows: [
          r('541362', '11:15', '141.8', '19:05', 'FRANCISCO MARCOS', 'ALICE VITORIA'),
          r(null, '11:15', '141.5', '18:45', 'GILDEON AIRES', 'LUKAS GABRIEL'),
          r(null, '11:30', '141.5', '19:00', 'ALEX OLIVERIA', 'SAMARA CHAVES'),
          r('541397', '11:35', '782.1', '19:10', 'LUCIANO MEDEIROS', 'KENAN CARDOSO'),
          r('541427', '11:40', '141.1', '19:30', 'PABLO HENRIQUE', 'CINTHIA MARTINS'),
          r('541508', '11:48', '141.5', '19:00', 'NATAN ARAUJO', 'TATIANE SANTOS'),
          r('541664', '12:15', '0.783', '19:55', 'CHARLES VAGNER', 'EMILY CRISTINE'),
          r('541524', '12:30', '141.8', '20:20', 'JHONATHA OLIVERIA', 'APIKA CHRISTIANO'),
          r('541532', '12:35', '0.783', '19:05', 'DIEGO FERREIRA', 'ATYLA MENDES'),
          r('541371', '12:36', '141.5', '20:30', 'FRANCISCO DA SILVA', 'MIKE RENAN'),
          r(null, '12:50', '141.5', '20:15', 'ANTONIO CARLOS', 'SIMONE FRAZAO'),
          r('541630', '13:05', '0.783', '19:35', 'IGOR VINICIUS', 'RAIANA VENANCIO'),
          r('541516', '13:15', '141.7', '20:20', 'DAVI MARTINS', 'MAICON JHONY'),
          r('541478', '13:24', '141.5', '20:05', 'WELINGTON SOUSA', 'ROSILDA ARAUJO'),
          r('541435', '13:35', '141.6', '21:10', 'LAURO NETO', 'NATANE MICAELE'),
          r('541567', '13:35', '0.783', '20:35', 'FRANCISCO RENES', 'RAQUEL SOARES'),
          r('541354', '13:48', '141.6', '21:30', 'EVANDRO SOUSA', 'GABRIEL SILVA'),
          r('541605', '13:50', '783.2', '21:30', 'ILAN ROCHA', 'PAULO OLIVEIRA'),
          r('541460', '14:00', '141.1', '22:00', 'GERMANO CARVALHO', 'LUCAS GOMES'),
          r('541486', '14:01', '141.6', '21:50', 'GEICSON RIBEIRO', 'GENDRY BIENVENUE'),
          r('541451', '14:05', '0.783', '20:45', 'FERNANDO SILVA', 'VANDERLENE MATIAS'),
          r('541443', '14:14', '141.6', '21:25', 'FRANCISCO FONTINELE', 'MARIA IRENE'),
          r('541346', '14:20', '141.9', '21:50', 'DEOMIDIO SANTOS', 'EDSON TEXEIRA'),
          r('541541', '14:25', '0.783', '22:15', 'MAX WELLY', 'PAULO EDUARDO'),
          r('541141', '14:27', '141.6', '22:00', 'DEIVISON WELLINGTON', 'ISAAC DE JESUS'),
          r('541575', '14:40', '141.7', '22:50', 'ANTONIO MANOEL', 'BISMARCK PEREIRA'),
          r('541559', '14:40', '141.2', '22:40', 'CLAUDIO NUNES', 'EDVAR SANTOS'),
          r('541648', '15:00', '783.3', '22:55', 'PAULO SERGIO', 'PAULO HENRRIQUE'),
          r('541419', '15:45', '0.783', '22:20', 'JOSE GIOMAR', 'WEMERSON GESTEIRA'),
          r('541672', '16:40', '0.783', '23:20', 'VENILSO MOURA', 'ISMAEL CARLOS'),
          r('541656', '18:20', '0.783', '00:20', 'RUBENS XAVIER', 'DAVI SANTANA'),
        ],
      },
    ],
  },
  {
    name: 'seed_sabado_2026-10-10',
    date: '2026-10-10',
    sections: [
      {
        shift: 'Manhã',
        rows: [
          r('541664', '05:15', '0.783', '12:48', 'MATEUS BATISTA', 'VINICIUS ALVES'),
          r('541478', '05:20', '141.2', '12:50', 'FRANCISCO IVANILDO', 'MATHEUS FEITOSA'),
          r('541516', '05:25', '783.2', '12:35', 'JOSE FERREIRA', 'MARIVALDO MIRANDA'),
          r('541486', '05:35', '141.7', '12:40', 'ELIDJHONY DE JESUS', 'PAULO VICTOR'),
          r('541575', '05:40', '141.9', '13:35', 'JOSE ALEXANDRE', 'LEIDINALDA MENDES'),
          r('541630', '05:40', '0.782', '13:00', 'ANDERSON WESLEY', 'WEDERSON OLIVEIRA'),
          r('541141', '05:50', '141.1', '13:15', 'HENRRIQUE GRECCO', 'MARCOS FRANCISCO'),
          r('541401', '05:50', '141.7', '13:00', 'CELIA MATIAS', 'IGOR HENRRIQUE'),
          r('541451', '06:00', '141.6', '13:15', 'MANOEL GOMES', 'IURI SOUSA'),
          r('541346', '06:00', '0.783', '12:45', 'RICARDO HENRRIQUE', 'UEDSON CAMPOS'),
          r('541672', '06:00', '141.8', '12:20', 'ANDRE SOARES', 'JOCINEIDE GINA'),
          r('541541', '06:05', '782.1', '13:15', 'MIRANOR RODRIGUES', 'ESTELA MOREIRA'),
          r('541397', '06:10', '0.783', '12:45', 'EDVAN MARCOS', 'ANA PAULA'),
          r('541559', '06:12', '141.6', '13:15', 'WESLEY BERNARDO', 'EDNA APARECIDA'),
          r('541435', '06:15', '783.1', '14:02', 'EMERSON AUGUSTO', 'MICAELE OLIVEIRA'),
          r('541605', '06:24', '141.6', '13:29', 'JOSE ALVES', 'CRISTIANE SANTOS'),
          r('541648', '06:30', '0.783', '13:30', 'WERBERT RIBEIRO', 'CASSIO JORDAN'),
          r('541371', '06:30', '783.3', '13:05', 'FERNANDO GUERREIRO', 'SAMUEL CESAR'),
          r('541443', '06:36', '141.6', '13:40', 'RONILDO HENRRIQUE', 'TIAGO DARLON'),
          r('541419', '06:40', '0.782', '13:48', 'ANTONIO JOSE', 'ALESSANDRA CORREIA'),
          r('541656', '06:40', '0.783', '13:35', 'CLAUDIO LOPES', 'JOSIANE ANTUNES'),
          r('541389', '06:48', '141.6', '13:53', 'GILDASIO PEREIRA', 'MARIA MARLI'),
          r('541532', '06:50', '141.2', '14:35', 'WEVERTON RODRIGUES', 'KEVIM SILVA'),
          r('541524', '06:55', '0.783', '14:10', 'IVANILSO ALVES', 'RIQUELME CASTRO'),
          r('541583', '07:10', '0.782', '13:55', 'PAULO HENRRIQUE', 'ADRYELE SILVERIO'),
          r('541427', '07:30', '0.783', '14:10', 'JAILSIO SANTOS', 'YANNY ALICE'),
          r('541362', '07:45', '0.783', '14:30', 'WENDERSON RENATO', 'EMILY JULLY'),
          r('541591', '08:00', '0.782', '15:00', 'DEMETRIUS BARBOSA', 'DANIELE SILVA'),
          r('541621', '08:00', '141.8', '15:20', 'FABIO ALVES', 'YAN GOMES'),
        ],
      },
      {
        shift: 'Tarde',
        rows: [
          r('541354', '11:00', '141.1', '18:53', 'ADILSON OLIVEIRA', 'FRANCIELMA CANDIDA'),
          r('541800', '11:50', '141.9', '18:00', 'DORUTEU MISQUITA', 'CAMILA RIBEIRO'),
          r('541508', '12:00', '0.783', '18:40', 'FRANCISCO GILVAN', 'ANA FLAVIA'),
          r('541613', '12:10', '0.783', '18:50', 'MARILENE RODRIGUES', 'ISABELY CRISTINE'),
          r('541460', '12:30', '0.783', '19:40', 'MATTHAUS RODRIGUES', 'FILIPE GABRIEL'),
          r('541567', '12:45', '0.783', '19:25', 'ADAILTON RIBEIRO', 'MEIRIANE PEREIRA'),
          r('541486', '13:00', '0.783', '19:40', 'FELICIANO VIEIRA', 'MARIVALDO MIRANDA'),
          r('541346', '13:12', '141.6', '20:20', 'ARTHUR PASSOS', 'MARCOS FRANCISCO'),
          r('541664', '13:15', '0.783', '20:15', 'DYEGO SANTOS', 'JESSICA SOUSA'),
          r('541478', '13:20', '141.8', '21:25', 'JOSE FERREIRA', 'VINICIUS ALVES'),
          r('541397', '13:24', '141.6', '20:40', 'RICARDO HENRRIQUE', 'UEDSON CAMPOS'),
          r('541141', '13:30', '0.783', '20:30', 'ADRIANO FRANCISCO', 'EDUARDO LUCENA'),
          r('541451', '13:36', '141.6', '20:50', 'CASSIOMAR NUNES', 'MATHEUS FEITOSA'),
          r('541630', '13:45', '141.9', '20:50', 'LAURO NETO', 'IGOR HENRRIQUE'),
          r('541401', '13:45', '0.783', '20:40', 'EDVAN MARCOS', 'ANA PAULA'),
          r('541559', '13:48', '141.6', '21:50', 'FRANCISCO SOUSA', 'SAMUEL CESAR'),
          r('541541', '13:50', '141.1', '21:20', 'LUIZ FELIPE', 'YASMIM COSTA'),
          r('541371', '13:58', '141.6', '21:50', 'MARCELO MACHADO', 'GENDRY BIENVENUE'),
          r('541672', '14:00', '0.783', '20:40', 'IVANIR MARQUES', 'EDNA APARECIDA'),
          r('541648', '14:00', '141.8', '21:50', 'ANDRAIDE DA CONCEIÇÃO', 'PAULO PINHO'),
          r('541443', '14:10', '141.6', '21:30', 'ANA BEATRIZ', 'WEDERSON OLIVEIRA'),
          r('541419', '14:30', '782.1', '22:30', 'MIKAEL NASCIMENTO', 'MARCOS HENRRIQUE'),
          r('541575', '14:39', '0.783', '21:20', 'ANDRE AUGUSTO', 'NATAN EMANUEL'),
          r('541389', '15:00', '0.782', '22:55', 'LEANDRO FERREIRA', 'DANILO ALVES'),
          r('541435', '15:40', '0.782', '22:30', 'ROGERIO COELHO', 'RICARDO MARQUES'),
          r('541591', '16:10', '783.1', '23:20', 'EFRASIO PIRES', 'DIONIZIA SILVA'),
          r('541621', '17:00', '0.783', '22:50', 'DANIEL ALVES', 'JHONATHA SOUSA'),
          r('541711', '17:15', '0.783', '23:00', 'JHONATHA DIAS', 'LUCAS SILVA'),
          r('541532', '18:00', '0.783', '00:20', 'GILVAN ALVES', 'MIZAEL OLIVEIRA'),
        ],
      },
    ],
  },
];
