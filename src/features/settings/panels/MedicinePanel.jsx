import InventoryMappingPanel from './InventoryMappingPanel';

export default function MedicinePanel(props) {
  return (
    <InventoryMappingPanel
      title="약품설정"
      itemLabel="약품 항목"
      emptyIcon="medication"
      emptyMessage="약품 설정을 시작하려면 먼저 엑셀 시트를 선택해주세요."
      saveIcon="medication"
      saveLabel="약품 데이터 저장하기"
      confirmMessage="기존 약품 데이터를 데이터베이스에 저장하시겠습니까?"
      incompleteMessage="모든 약품 항목의 칼럼 선택이 완료되어야 저장할 수 있습니다."
      {...props}
    />
  );
}
